# Embedding 模型 100% 卡住根因分析

> 现象：进度条到达 100%、日志显示 `[Embedding Worker] 模型下载进度: 100.0%` 后，界面一直停留在加载页，不会进入文档库。  
> 更新日期：2025-03-10

---

## 一、现象与结论

**现象**：
- 控制台输出多次 `模型下载进度: 100.0%` 和 `onnx/model_quantized.onnx`
- 从未出现 `[Embedding Worker] 模型加载完成`
- 主线程从未收到 `ready` 消息
- 界面一直停在「向量化模型加载中 100%」

**结论**：`pipeline()` 在模型文件下载完成后**未 resolve**，在后续阶段（WASM 初始化 / InferenceSession 创建）发生阻塞或挂起。

---

## 二、`pipeline()` 的完整执行流程

`progress_callback` 只在**模型文件下载**阶段被调用。整体流程大致如下：

```
1. 下载阶段（有 progress_callback）
   ├─ 拉取 config.json、tokenizer 相关文件
   ├─ 拉取 model_quantized.onnx（约 47MB）
   └─ 当所有文件拉取完成 → progress 到达 100%

2. 下载后阶段（无 progress_callback）
   ├─ 调用 createInferenceSession(modelBuffer)
   ├─ onnxruntime-web 需要：
   │   ├─ 加载 WASM：ort-wasm-simd.wasm 等（从 CDN）
   │   ├─ WebAssembly.instantiate()：编译并实例化 WASM
   │   └─ 创建 InferenceSession：解析 ONNX、构建执行图
   └─ 全部完成后 pipeline() 才 resolve
```

因此，**100% 只表示“模型文件下载完成”，之后的 WASM 加载和 Session 创建没有任何进度回调**，一旦卡住就会表现为“一直停在 100%”。

---

## 三、可能的卡住点与成因

### 3.1 WASM 加载与实例化（最可疑）

**流程**：
1. onnxruntime-web 首次调用 `InferenceSession.create()` 时会加载 WASM
2. WASM 来源：`https://cdn.jsdelivr.net/npm/@huggingface/transformers@{version}/dist/`
3. 然后执行 `WebAssembly.instantiate()`，这一步可能耗时、占内存、甚至挂起

**可能原因**：

| 原因 | 说明 |
|------|------|
| **SIMD WASM 与部分环境不兼容** | 默认使用 `ort-wasm-simd.wasm`。某些浏览器/内核（特别是 Safari / iOS WebKit）对 SIMD 支持不完善，可能导致编译失败或卡住 |
| **多线程 + COOP/COEP** | 若页面设置了 COOP/COEP，`crossOriginIsolated` 为 true，ORT 可能使用多线程 WASM。iOS/iPad 上多线程 WASM 支持有问题，会静默挂起（见 [onnxruntime #11679](https://github.com/microsoft/onnxruntime/issues/11679)） |
| **SharedArrayBuffer 相关** | 多线程依赖 SharedArrayBuffer。若 COOP/COEP 配置不当，可能导致 fallback 逻辑异常或长时间等待 |
| **WASM 编译阻塞** | `WebAssembly.instantiate` 在主线程或 Worker 线程执行，可能长时间占用 CPU，在某些设备上表现为“假死” |

### 3.2 环境相关（浏览器 / 设备）

**已知问题**：
- **iOS/iPad Safari/Chrome**：COOP/COEP 启用时，`InferenceSession.create` 会挂起；`numThreads=1` 可缓解
- **某些旧设备**：WASM 实例化时可能抛出 `RangeError: Out of memory`

**当前环境**：
- 用户为 `darwin 23.6.0`（macOS），但未区分浏览器（Safari / Chrome 等）
- Vite 开发服务器默认**不**设置 COOP/COEP，通常 `crossOriginIsolated === false`，理论上是单线程路径

### 3.3 Worker 环境

- Embedding 在 **Web Worker** 中运行
- Worker 内无法直接创建 WebGL 上下文，因此使用 `device: "wasm"` 正确
- Worker 中加载 CDN 上的 WASM 可能涉及：
  - CORS（通常 CDN 已正确配置）
  - Worker 内的 fetch/import 行为与主线程略有不同，但一般不会导致无限阻塞

### 3.4 量化模型（dtype: "q8"）

- 使用 `model_quantized.onnx`（int8 量化）
- 量化模型推理路径与 fp32 不同，但通常在 ORT 中已稳定
- 更可能的仍是 WASM 加载/初始化阶段，而非模型执行阶段

---

## 四、排查步骤

### 4.1 确认卡住发生的阶段

在 Worker 中、`pipeline()` 调用前增加诊断日志，区分「下载完成后」与「WASM/Session 阶段」：

```ts
// 在 progress 首次达到 100% 时
if (overall >= 0.999) {
  console.warn("[Embedding Worker] 文件下载完成，即将创建 InferenceSession（WASM 加载 + 模型解析）");
}
```

若能看到该日志，说明卡在「创建 InferenceSession」之后（WASM 加载或 Session 创建）。

### 4.2 检查 COOP/COEP 和 crossOriginIsolated

在浏览器控制台执行：

```javascript
console.log('crossOriginIsolated:', self.crossOriginIsolated);
console.log('SharedArrayBuffer:', typeof SharedArrayBuffer);
```

- 若 `crossOriginIsolated === true` 且当前环境有已知问题，可尝试强制 `numThreads = 1`
- 若 `SharedArrayBuffer === "undefined"`，说明未启用跨域隔离，ORT 应已走单线程路径

### 4.3 确认浏览器与版本

在控制台执行：

```javascript
console.log(navigator.userAgent);
```

便于对照已知的 ORT / Transformers.js 兼容性问题。

### 4.4 显式设置 numThreads 和 SIMD

在调用 `pipeline()` 之前，显式配置 ORT 环境，降低多线程和 SIMD 带来的风险：

```ts
import { pipeline, env } from "@huggingface/transformers";

// 在 pipeline 调用之前
const ort = (env.backends as any)?.onnx;
if (ort?.env?.wasm) {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = false;  // 若仍卡住，可尝试关闭 SIMD
}
```

---

## 五、可能有效的修复方向

| 方向 | 操作 | 说明 |
|------|------|------|
| **1. 强制单线程** | `ort.env.wasm.numThreads = 1` | 避免多线程 WASM 在部分环境挂起 |
| **2. 关闭 SIMD** | `ort.env.wasm.simd = false` | 使用非 SIMD 的 ort-wasm.wasm，兼容性更好 |
| **3. 检查 COOP/COEP** | 确认页面未意外设置这些头 | 开发环境一般不会，但需排除 |
| **4. 更换运行环境** | 在主线程或不同浏览器中测试 | 区分 Worker / 浏览器 / 设备问题 |
| **5. 使用 ORT wasm 子包** | `import * as ort from 'onnxruntime-web/wasm'` | 某些环境（如 iOS）需用 wasm 专用包（参见 transformers.js #1242） |

---

## 六、建议的下一步

1. **立刻尝试**：在 Worker 中、`pipeline()` 前执行 `ort.env.wasm.numThreads = 1`，并观察是否能通过 100% 进入就绪。
2. **若仍卡住**：再设置 `ort.env.wasm.simd = false`，排除 SIMD 相关问题。
3. **收集环境信息**：记录 `crossOriginIsolated`、`SharedArrayBuffer`、`navigator.userAgent`，便于进一步定位。

---

## 七、参考资料

- [ONNX Runtime #11679](https://github.com/microsoft/onnxruntime/issues/11679): iOS 上 COEP/COOP 导致 InferenceSession 挂起
- [ONNX Runtime #26858](https://github.com/microsoft/onnxruntime/issues/26858): 多线程 + 外部数据时 Session 创建挂起
- [Transformers.js #1242](https://github.com/huggingface/transformers.js/issues/1242): iOS 使用 `onnxruntime-web/wasm` 的 workaround
- [web.dev - Cross-Origin Isolation](https://web.dev/cross-origin-isolation-guide/): COOP/COEP 与 SharedArrayBuffer 说明

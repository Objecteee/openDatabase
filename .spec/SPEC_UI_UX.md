# UI/UX 交互与排版规格说明书 (SPEC_UI_UX.md)

## 一、 全局设计规范 (Global Design Tokens)

### 1. 适配方案：工程化 rem2px

* **设计基准**：以 $750px$ 宽度为设计稿基准。
* **换算公式**：$1rem = 75px$ (在屏幕宽度为 $750px$ 时)。
* **单位限制**：
* 严禁在 CSS、Tailwind 类或内联样式中使用 `px`（除 $1px$ 物理边框外）。
* 所有间距 (`padding`, `margin`)、字号 (`font-size`)、圆角 (`border-radius`) 必须使用 Tailwind 的 rem 相关单位。


* **响应式策略**：
* **Desktop**: 固定最大宽度限制，内容区居中。
* **Mobile**: $100\%$ 宽度流式适配。



### 2. 配色与风格 (Theme)

* **模式支持**：原生支持 Dark / Light Mode 切换，优先适配深色模式。
* **核心色彩**：基于 `shadcn/ui` 预设，主色调为科技蓝（用于 Action 按钮、进度条）。
* **材质**：导航栏与侧边栏需使用 `backdrop-blur-md` 磨砂玻璃质感。

---

## 二、 布局架构说明 (Adaptive Layout)

### 1. 桌面端三栏布局 (Desktop: >768px)

* **左侧资产导航 (Fixed: 260px)**：
* **顶栏**：项目 Logo 及 **Transformers.js 单例模型状态指示器**（展示加载百分比）。
* **列表区**：按模态分类（文本、PDF、视频、音频、图片）的文件树，支持拖拽排序。
* **底栏**：用户信息、设置按钮及 **Performance Monitor** 实时看板触发器。


* **中间对话主场 (Flex-1)**：
* **内容区**：虚拟列表 (Virtual List) 渲染对话气泡，确保万级消息不卡顿。
* **输入区**：悬浮式设计，包含多模态附件预览条（待上传文件卡片）及 AI 命令输入框。


* **右侧深度预览 (Fixed: 400px)**：
* 默认收起，当用户点击对话中的 **Citation (引用标签)** 时自动平滑滑出。



### 2. 移动端抽屉布局 (Mobile: <=768px)

* **交互逻辑**：
* 顶部导航栏包含汉堡菜单（呼起左侧资产栏）及预览切换按钮。
* 预览内容不占屏幕宽度，通过 **Bottom Drawer (底部抽屉)** 向上弹出展示。
* 针对触控优化的长按手势菜单，用于处理文件的删除与重命名。



---

## 三、 核心组件交互细节 (Core Component Interactions)

### 1. AI 对话与溯源 (Citations)

* **流式渲染 (SSE)**：
* 必须结合 `requestAnimationFrame` 进行打字机效果输出，防止高频数据传输导致的 UI 抖动。


* **引用标签 (Citation Tags)**：
* 样式：在 AI 回复中嵌入 `[^n]` 样式的蓝色数字标签。


* **点击联动逻辑**：
* 点击标签后，右侧预览组件执行 `scrollToPointer` 逻辑。
* **PDF**: 自动翻至对应页码并对相关文本行进行黄色高亮处理。
* **视频**: 播放器自动跳转至目标时间戳（格式如 `02:15`）并播放。



### 2. 全模态文件上传流

* **上传反馈**：
* 拖拽文件进入浏览器时，全屏出现 `backdrop-filter: blur(4px)` 的蓝色虚线接收区。


* **Web Worker 联动状态**：
* 列表项实时展示 **Hash Worker** 计算进度（计算 MD5 用于秒传校验）。
* 紧接着展示 **Embedding Worker** 的向量计算进度（进度条动效）。



### 3. 模型单例加载 (Model Loading)

* **视觉占位**：
* 在模型加载未完成前，对话输入框处于 `disabled` 状态，并显示“AI 引擎初始化中...”的骨架屏占位。
* 侧边栏底部持久化显示模型的下载百分比（通过 Transformers.js `progress_callback` 获取数据）。



---

## 四、 Superpowers 技能在 UI 的体现

* **Brainstorming 过程可视化**：
* 当 AI 调用 `skill-brainstorming` 时，对话框顶部显示“Architect 正在规划设计方案...”及进度动效。


* **任务清单 (TODO.md) 浮窗**：
* 开发模式下，右下角可展开当前 `skill-writing-plans` 生成的 Checklist 实时进度。


* **验证反馈 (Verification)**：
* 功能完成后，UI 自动弹出自检看板，确认 rem 适配、单例内存占用及国际化词条同步情况。



---

## 五、 Cursor 专用生成指令 (Instruction Set)

Cursor 执行前端任务时必须检查：

1. **适配检查**：计算所有组件的宽、高、内边距是否为 `(px / 75)rem`？
2. **性能检查**：消息气泡是否使用了 `React.memo` 避免冗余渲染？
3. **状态管理**：全局 UI 状态（如 `isSidebarOpen`, `currentPreviewAsset`）是否统一存储在 Zustand 中？

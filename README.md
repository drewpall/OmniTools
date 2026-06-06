# 极客万能工具箱 (OmniToolbox) - 纯前端视频压缩工具

这是一个设计精美、极具未来感的纯前端**万能工具箱（All-in-One Toolbox）**，首期完整实现了核心的**视频一键压缩工具**。

该工具利用 WebAssembly 技术（基于 `ffmpeg.wasm`），**完全在用户的浏览器本地**对视频进行解析、转码与压缩。

## ✨ 核心特性

- **100% 隐私安全**：视频处理全部在本地设备进行，绝不上传到任何服务器，绝不消耗任何网络上传流量，保护您的数据隐私。
- **自定义压缩配置**：
  - **分辨率**：支持保持原样，或一键缩放到 1080p, 720p, 480p, 360p 等常用规格。
  - **目标帧率**：支持限制帧率为 60, 30, 24, 15 FPS 等，降低高频帧带来的体积消耗。
  - **恒定画质比率 (CRF)**：滑动调节画面精细度，在画质与大小之间取得最佳平衡。
  - **音轨处理**：支持保留音轨、高码率压缩音轨以节省空间，或彻底移除音轨（静音）。
  - **多格式编码**：支持输出高兼容性的 MP4 (H.264) 或更小体积的 WebM (VP9)。
- **硬件加速优化**：支持动态检测并开启多线程加速，大幅缩短等待时间。
- **极客风日志终端**：配备可折叠的日志控制台，实时查看底层 FFmpeg 的转码 stdout/stderr 日志。
- **直观效果对比**：提供压缩前后视频双播放器横向对比，并显示精确的体积节省比率。
- **模块化预留**：采用现代化仪表盘面板设计，预留了图片压缩、音频转换、PDF工具等后续扩展板块的入口。

---

## 🛠️ 本地运行开发

为了调试多线程加速模式，本地需要提供开启跨域隔离（COOP/COEP）响应头的 Web 服务器。我们为您准备了 Python（免安装依赖）和 Node.js（适合前端开发者）两种一键启动方案。

### 方案 A：使用 Python 启动 (推荐，无需安装依赖)
由于您的系统已安装 Python，直接在项目根目录下使用终端运行以下命令：
```bash
python server.py
```
启动后，终端将输出：
```text
==================================================
🚀 [OmniToolbox] Python Local Server is running!
🔗 Address: http://localhost:3000
🔒 Cross-Origin Isolation headers have been injected.
==================================================
```
使用现代浏览器访问 `http://localhost:3000` 即可。

### 方案 B：使用 Node.js 启动 (需要 Node 环境)
1. 安装 Express 依赖：
   ```bash
   npm install
   ```
2. 启动开发服务器：
   ```bash
   npm run dev
   ```
访问 `http://localhost:3000` 即可。

使用现代浏览器访问以上链接，顶部状态栏将显示 `多线程加速已启用 (🚀 极速压缩)`。如果直接双击 `index.html` 打开（`file://` 协议），由于浏览器安全策略限制，会降级到单线程兼容模式运行（压缩速度较慢）。

---

## 🚀 部署到 GitHub Pages 🚀

由于本项目使用了 `coi-serviceworker.js` 黑科技方案，您可以**完美地将此项目部署到 GitHub Pages 等任何静态网站托管服务**上，而无需担心静态服务器无法设置 COOP/COEP 头的问题。

### 部署步骤

1. **新建 GitHub 仓库**：在您的 GitHub 账户下新建一个公开的仓库（例如 `omni-toolbox`）。
2. **提交代码**：将项目中的所有文件推送到该仓库中：
   - `index.html`
   - `styles.css`
   - `app.js`
   - `coi-serviceworker.js`
3. **开启 GitHub Pages**：
   - 在您的 GitHub 仓库页面，点击 **Settings** (设置) -> **Pages**。
   - 在 **Build and deployment** 下的 **Source** 选择 `Deploy from a branch`。
   - **Branch** 选择 `main` (或您提交的分支) 及 `/root` 目录，点击 **Save**。
4. **访问页面**：
   - 稍等 1-2 分钟，GitHub 会生成您的专属链接（例如 `https://<your-username>.github.io/omni-toolbox/`）。
   - 打开该链接，`coi-serviceworker.js` 会在后台自动激活 Service Worker 并刷新页面。刷新后，即可完美开启**多线程高速压缩**！

### ⚠️ 静态部署注意事项
- **HTTPS 必须**：Service Worker 只有在 HTTPS 安全上下文（GitHub Pages 默认提供）或本地 `localhost`/`127.0.0.1` 下才会工作。
- **跨域资源 (CORS)**：如果在代码中拉取了第三方静态资源（如视频测试源），该服务器必须支持 CORS，否则在“跨域隔离”环境下会被浏览器拦截。

---

## 📝 架构设计文件

- [index.html](file:///c:/Users/Administrator/Desktop/web/index.html) - 主体结构
- [styles.css](file:///c:/Users/Administrator/Desktop/web/styles.css) - 深色磨砂玻璃样式系统
- [app.js](file:///c:/Users/Administrator/Desktop/web/app.js) - 核心路由切换与 FFmpeg.wasm 压缩逻辑
- [coi-serviceworker.js](file:///c:/Users/Administrator/Desktop/web/coi-serviceworker.js) - 静态页面跨域隔离注入脚本
- [server.js](file:///c:/Users/Administrator/Desktop/web/server.js) - Express 本地开发服务器 (Node.js)
- [server.py](file:///c:/Users/Administrator/Desktop/web/server.py) - Python 本地开发服务器 (免安装依赖)

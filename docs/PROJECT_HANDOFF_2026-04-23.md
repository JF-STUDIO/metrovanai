# Metrovan AI 网站交接记录（2026-04-23）

## 1. 项目位置

- 主仓库：
  [C:\Users\zhouj\文档\网站制作\网站服务器接口](/C:/Users/zhouj/文档/网站制作/网站服务器接口)
- 前端：
  [client](/C:/Users/zhouj/文档/网站制作/网站服务器接口/client)
- 后端：
  [server](/C:/Users/zhouj/文档/网站制作/网站服务器接口/server)
- 本地运行数据：
  [server-runtime](/C:/Users/zhouj/文档/网站制作/网站服务器接口/server-runtime)

## 2. 域名与部署现状

- 主域名：`metrovanai.com`
- API 域名：`api.metrovanai.com`
- 前端生产环境 API 配置：
  [client/.env.production](/C:/Users/zhouj/文档/网站制作/网站服务器接口/client/.env.production)
- Cloudflare Tunnel 配置：
  [deployment/cloudflare-tunnel/config.yml](/C:/Users/zhouj/文档/网站制作/网站服务器接口/deployment/cloudflare-tunnel/config.yml)
- Tunnel 当前配置目标：`http://127.0.0.1:8787`

当前本地后端健康检查：

- [http://127.0.0.1:8787/api/health](http://127.0.0.1:8787/api/health)

## 3. 当前网站实际运作逻辑

### 3.1 首页

- 首页是深色视频 hero + 展示区 + 引言区。
- 当前首页已经恢复到“方向接近删除前版本”的状态，但**还不是 100% 一样**。
- 顶部品牌、展示区、登录弹窗、工作台视觉仍需继续收细节。

首页代码入口：

- [client/src/App.tsx](/C:/Users/zhouj/文档/网站制作/网站服务器接口/client/src/App.tsx)
- [client/src/App.css](/C:/Users/zhouj/文档/网站制作/网站服务器接口/client/src/App.css)

### 3.2 登录 / 注册

- 当前登录/注册是前端弹窗壳。
- 有切换 tab、邮箱、密码、确认密码、Google 按钮视觉壳。
- **没有真实后端认证**。
- **没有真实 Google OAuth**。
- 当前更接近“本地演示登录”，不是可上线认证系统。

### 3.3 项目与上传

当前实际逻辑是：

1. 用户新建项目。
2. 用户导入照片。
3. **原始文件会立即上传到本地后端**。
4. 后端保存到项目目录中的 `原始` 文件夹。
5. 后端生成预览图到 `缩略图` 文件夹。
6. 后端根据 EXIF / 曝光信息做 HDR 分组。
7. 后端调用场景分类器做 `interior / exterior / pending` 判断。
8. 前端显示 HDR 组，用户可改组、删组、切曝光、改颜色模式。

这和用户最早设想的“先本地/预览图确认，再正式上传 RAW”**不一致**。  
当前版本是：**导入即上传原始文件到后端**。

相关代码：

- 上传接口：
  [server/src/index.ts](/C:/Users/zhouj/文档/网站制作/网站服务器接口/server/src/index.ts)
- 导入处理：
  [server/src/importer.ts](/C:/Users/zhouj/文档/网站制作/网站服务器接口/server/src/importer.ts)
- HDR 分组：
  [server/src/grouping.ts](/C:/Users/zhouj/文档/网站制作/网站服务器接口/server/src/grouping.ts)
- 场景分类：
  [server/src/scene-classifier.ts](/C:/Users/zhouj/文档/网站制作/网站服务器接口/server/src/scene-classifier.ts)

### 3.4 分组与颜色

当前组上可配置：

- `sceneType`
  - `interior`
  - `exterior`
  - `pending`
- `colorMode`
  - `default`
  - `replace`
- `replacementColor`
  - HEX，例如 `#D2CBC1`

当前业务含义：

- `interior + replace`
  - 走室内保留原始墙面色彩工作流
  - 会把颜色 HEX 写到 workflow 的 prompt 节点
- `exterior`
  - 走室外 workflow
- `interior + default`
  - 当前也走 bypass / 默认不改墙色路径

相关代码：

- [server/src/workflows.ts](/C:/Users/zhouj/文档/网站制作/网站服务器接口/server/src/workflows.ts)
- [server-runtime/workflows.json](/C:/Users/zhouj/文档/网站制作/网站服务器接口/server-runtime/workflows.json)

### 3.5 HDR 合并与 RunningHub

当前处理链实际顺序：

1. 项目进入处理状态。
2. 本地后端逐个 HDR 组处理。
3. 每个 HDR 组先做本地 HDR 合并。
4. **每个 HDR 合并完成后立刻送 RunningHub**。
5. 不等待所有 HDR 全部合并完再上传。
6. RunningHub 返回结果后，结果图保存到 `结果` 文件夹。
7. 前端轮询项目状态并显示结果。

当前本地 HDR 处理链主要在：

- [server/src/images.ts](/C:/Users/zhouj/文档/网站制作/网站服务器接口/server/src/images.ts)

当前 RunningHub 处理与回传主要在：

- [server/src/processor.ts](/C:/Users/zhouj/文档/网站制作/网站服务器接口/server/src/processor.ts)
- [server/src/runninghub.ts](/C:/Users/zhouj/文档/网站制作/网站服务器接口/server/src/runninghub.ts)

### 3.6 白平衡和本地 HDR 处理现状

当前版本已经不是最早那条错误的白平衡链路，但质量仍未完全收完。

当前方向大致是：

- RawTherapee 解 RAW
- 参考帧自动白平衡
- 组级统一白平衡
- HDR 对齐与 enfuse 合并

但需要明确：

- 这条链能跑
- 不代表成片质量已经完全达到删除前目标
- 某些组仍可能出现白平衡、场景分类、合并观感不稳定

### 3.7 结果显示与下载

当前已恢复：

- 结果图列表显示
- 结果图排序拖拽
- 排序顺序持久化到后端
- 基础放大查看器
- 基础项目下载按钮

当前下载的真实能力：

- 会按当前结果顺序打一个 `HD` zip 包
- 压缩包来自项目 `结果` 文件夹

当前还**没有**完整恢复：

- MLS 尺寸导出
- 自定义尺寸
- 自定义命名规则
- 多文件夹结构（HD / MLS）
- 下载时按用户选项动态生成

## 4. 当前后端 API

已存在的主要接口：

- `GET /api/health`
- `GET /api/projects`
- `GET /api/projects/:id`
- `POST /api/projects`
- `PATCH /api/projects/:id`
- `DELETE /api/projects/:id`
- `GET /api/projects/:id/download`
- `POST /api/projects/:id/files`
- `POST /api/projects/:id/groups`
- `PATCH /api/projects/:id/groups/:groupId`
- `PATCH /api/projects/:id/hdr-items/:hdrItemId/select`
- `POST /api/projects/:id/hdr-items/:hdrItemId/move`
- `DELETE /api/projects/:id/hdr-items/:hdrItemId`
- `POST /api/projects/:id/results/reorder`
- `POST /api/projects/:id/start`

入口文件：

- [server/src/index.ts](/C:/Users/zhouj/文档/网站制作/网站服务器接口/server/src/index.ts)

## 5. 本地磁盘结构

当前项目目录下的标准子目录已经修正为：

- `原始`
- `缩略图`
- `HDR合并`
- `结果`

说明：

- 本轮已经修复过一次后端乱码目录名问题。
- 如果旧项目还残留乱码目录，`store.ts` 会尝试迁移到正确目录名。

目录逻辑在：

- [server/src/store.ts](/C:/Users/zhouj/文档/网站制作/网站服务器接口/server/src/store.ts)

## 6. 与删除前版本相比，当前已经恢复的部分

### 已恢复较多

1. 项目系统
   - 新建项目
   - 打开项目
   - 删除项目
   - 重命名项目

2. 上传与 HDR 分组
   - 原图上传
   - 预览生成
   - 自动 HDR 分组

3. 分组与颜色
   - 手动建组
   - HDR 组移动
   - 曝光切换
   - 组颜色模式和 HEX

4. 本地处理链
   - 本地 HDR 合并
   - RunningHub 流式提交
   - 结果回传

5. 结果基础交互
   - 放大查看
   - 结果排序
   - 基础 zip 下载

### 部分恢复

1. 首页
   - 已恢复到接近删除前方向
   - 但不是 100% 一样

2. 登录/注册弹窗
   - 已恢复黑玻璃风格壳
   - 但不是 100% 一样
   - 且没有真实认证

3. 工作台 UI
   - 结构和主流程回来不少
   - 但视觉密度、间距、组件细节、信息层级还没完全回到删除前

## 7. 当前还没恢复 / 明显缺失的功能

### 7.1 真实认证系统

当前问题：

- 只是前端本地会话
- 没有后端账号系统
- 没有真实登录接口
- 没有 Google OAuth

### 7.2 下载系统完整功能

当前问题：

- 只有基础 `HD zip`
- 还没有：
  - MLS
  - 自定义尺寸
  - 自定义命名
  - 下载文件夹结构控制

### 7.3 积分 / 账单 / 充值

当前问题：

- 数据结构里有 `pointsEstimate / pointsSpent / BillingEntry`
- 但没有完整账单 API
- 没有充值流程
- 没有真实扣费系统

### 7.4 上传逻辑与原始目标不一致

用户历史目标是：

- 先快速预览图分组/确认
- 再正式上传原始文件

当前实现不是这样。  
当前实现是：**导入即上传原始文件到本地后端**。

### 7.5 任务恢复

当前问题：

- 服务重启后，正在运行的任务没有完整恢复机制
- 正在处理中的项目不是持久化队列系统

### 7.6 室内外分类 / 白平衡 / HDR 成片质量

当前问题：

- 技术链路可跑
- 但质量仍在调
- 不能认为已经完全达到删除前稳定成片标准

### 7.7 所有页面 100% 还原

这是当前最明确的未完成项之一。

用户当前要求是：

- 所有页面 UI 要和删除前版本 **100% 一样**

当前状态：

- **没有达到 100% 一样**
- 首页、登录/注册、工作台都仍有差距

## 8. 当前非 UI 功能风险

这几项不是样式问题，而是功能/上线问题：

1. 认证不真实
2. 下载系统不完整
3. 上传逻辑与最初业务设想不一致
4. 任务重启恢复缺失
5. 场景分类和成片质量未收完
6. 积分与账单仍是壳

## 9. 本轮已修复的功能问题（2026-04-23）

1. 修复后端存储目录乱码
2. 修复状态文案乱码
3. 修复工作流路由名乱码
4. 新增基础项目下载接口

关键修复文件：

- [server/src/store.ts](/C:/Users/zhouj/文档/网站制作/网站服务器接口/server/src/store.ts)
- [server/src/importer.ts](/C:/Users/zhouj/文档/网站制作/网站服务器接口/server/src/importer.ts)
- [server/src/processor.ts](/C:/Users/zhouj/文档/网站制作/网站服务器接口/server/src/processor.ts)
- [server/src/workflows.ts](/C:/Users/zhouj/文档/网站制作/网站服务器接口/server/src/workflows.ts)
- [server/src/index.ts](/C:/Users/zhouj/文档/网站制作/网站服务器接口/server/src/index.ts)

## 10. 推荐的后续开发顺序

### 第一优先级

1. 继续修 UI 到删除前 100% 一样
   - 首页
   - 登录/注册
   - 工作台

2. 做真实认证
   - 后端 auth
   - 真 session
   - Google OAuth

3. 完整下载系统
   - HD / MLS
   - 自定义尺寸
   - 自定义命名
   - 顺序联动下载

### 第二优先级

4. 上传流程重构到“先预览确认，再正式传 RAW”
5. 任务恢复 / 重启续跑
6. 积分、账单、充值流程

### 第三优先级

7. 继续收场景分类、白平衡、HDR 成片质量

## 11. 新线程继续时建议直接带的上下文

建议新线程第一句直接发：

```text
继续 Metrovan AI 网站，项目路径是 C:\Users\zhouj\文档\网站制作\网站服务器接口。
先读 docs/PROJECT_HANDOFF_2026-04-23.md。
当前重点：
1. 所有页面 UI 继续还原到删除前 100% 一样
2. 不要动现有处理主链，除非是修功能 bug
3. 然后继续做真实认证和完整下载系统
```

## 12. 结论

当前项目已经不是“从零恢复”状态了。  
核心处理链、项目管理、上传、HDR 分组、RunningHub 回传都已经接回。

但如果拿删除前版本做标准，当前仍然属于：

- **核心链路已恢复**
- **产品层和最终完成度未恢复**
- **离“删除前 100% 一样”还有明显距离**

下一线程应该继续做的，不是重新想方案，而是严格按这份文档收口。

# mcp_excalidraw — engram 档案索引

本仓库已接入 engram 系统。本文件是**指针快照**（权威在 engram，文档清单变化时同步更新本段）。

- **engram project**：`mcp_excalidraw`（id `01a0d3b3-6621-7412-8f1b-44f50690effc`）
- **codegraph**：`mcp_excalidraw`（cloud_index，git URL register，基线 head `6923cdcd`，freshness 服务端自校验 stale=false；代码变更后 `git push` + `codegraph sync`）
- **文档基线**：git HEAD `6923cdcdd5aeaffbfa2ab71c329952210cde3dc5`（2026-09-24 接入，后续 `/update-project` 的对齐起点）

## 文档清单（`projects doc_get`，project_name=mcp_excalidraw，按 doc_id 直达）

| title | category | doc_id |
|---|---|---|
| 项目概览 | 总览 | `01a0d3ba-eac1-7580-965d-4d84fa1b91f8` |
| 系统上下文 | 架构与实现 | `01a0d3c5-6675-71f2-bca1-9df5f8178d1a` |
| 模块地图 | 架构与实现 | `01a0d3bb-3d61-7940-84fc-4ce9e6293a47` |
| 数据模型 | 架构与实现 | `01a0d3bb-a11e-7312-a8e1-681e87322499` |
| API 与接口 | 架构与实现 | `01a0d3bc-ea10-7a70-a2a4-62ae884a0aac` |
| 运行时视图 | 架构与实现 | `01a0d3db-6976-7791-a7ae-c101b4ae7da0` |
| 部署与运维 | 运维 | `01a0d3e0-6a0b-7543-b2d0-547acb05119f` |
| 测试与门禁 | 运维 | `01a0d3e2-4647-7283-a17d-9ae7d9aba0f2` |
| 技术决策记录 | 决策 | `01a0d3e2-aa8e-7301-88a1-971b0f3082f4` |
| 风险与技术债 | 历史 | `01a0d3e3-136d-7e40-bf28-599b15c81190` |
| 术语表 | 总览 | `01a0d3e3-5cbb-79e1-9950-645e7937a455` |

## 图清单（`projects file_get` 按文件名取，暗色单文件 HTML 可直接打开）

| 文件 | 内容 |
|---|---|
| `diagram-01-context.html` | C4-L1 系统上下文（唯一主动外联=excalidraw.com share） |
| `diagram-02-modules.html` | 模块依赖图（7 层带 / 27 盒 / 22 依赖箭头） |
| `diagram-03-storage.html` | 持久化数据流+存储结构（SQLite/JSON 兜底） |
| `diagram-04-arch.html` | 分层运行时架构（MCP 进程/Canvas 进程/持久化） |
| `diagram-05-seq-main.html` | 时序：agent→MCP→REST→WS→浏览器 |
| `diagram-05-seq-persist.html` | 时序：debounce 落盘 + hydrate |
| `diagram-07-deploy.html` | 部署拓扑（Docker 双容器嵌套 + Host FS） |

## 检索配方

这项目是干嘛的→项目概览｜架构怎么设计→模块地图/系统上下文｜数据怎么存→数据模型｜接口/工具/鉴权→API 与接口｜跑起来什么流程→运行时视图｜怎么部署/环境变量→部署与运维｜怎么测试/门禁基线→测试与门禁｜为什么这么定→技术决策记录｜有什么坑→风险与技术债（39 条，高危 R1/R8/R16/R23）｜术语→术语表

## 更新纪律

- 文档/图清单变化（doc_add、file_put/新图）时**同步更新本段**；本段是快照，防双权威漂移只存指针不存正文
- 代码演进后：本机 `codegraph index` → `codegraph upload` 重传 db；文档对齐跑 `/update-project`

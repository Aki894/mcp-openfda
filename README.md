# OpenFDA Drug Label MCP Server

让 AI 助手检索 FDA 药品标签、提取安全信息与适应症、获取完整标签，并按字段统计检索结果。

[English](README.en.md) · [API](https://open.fda.gov/apis/drug/label/) · [GitHub Issues](https://github.com/Aki894/mcp-openfda/issues)

## 功能特性

- **`search_drug_labels`**：搜索药品标签，支持 openFDA 查询表达式、分页和字段统计；返回完整标签或 term/count 统计桶。
- **`get_drug_adverse_reactions`**：按通用名、商品名或成分名获取不良反应及禁忌原文，保留标签标识。
- **`get_drug_warnings`**：获取警告、注意事项、warnings_and_cautions 和黑框警告原文。
- **`get_drug_indications`**：获取适应症、用途及用法用量原文。
- **`get_drug_details`**：按 set_id 获取生效日期最新的一条完整标签；可选择顶层字段，正文不截断。
- **`search_labels`**：按药物名称和可选不良反应关键词检索四类安全章节。

## 快速开始

需要 Git、Node.js 22 或更高版本及 npm，并能访问 `api.fda.gov`。

```bash
git clone https://github.com/Aki894/mcp-openfda.git
cd mcp-openfda
npm ci
npm run build
```

### 配置 MCP 客户端

在支持 `mcpServers` 配置格式的客户端中加入以下条目，将入口替换为构建后的**绝对路径**：

```json
{
  "mcpServers": {
    "openfda": {
      "command": "node",
      "args": [
        "/absolute/path/to/mcp-openfda/dist/index.js"
      ]
    }
  }
}
```

Windows 可使用 `D:/mcp/mcp-openfda/dist/index.js`，避免 JSON 反斜杠转义。若客户端找不到 `node`，将 `command` 改为 Node.js 可执行文件的绝对路径。保存后重新加载 MCP 连接，检查工具列表。其他客户端请按其格式填写相同的命令与参数。

服务器使用 **stdio**，由 MCP 客户端启动，无需端口或 HTTP 地址。直接在终端启动后等待标准输入属于正常行为。

### 可选 API 密钥

可以不配置密钥试用。经常使用时建议申请 [openFDA API 密钥](https://open.fda.gov/apis/authentication/)，在服务器条目中加入：

```json
{"env": {"OPENFDA_API_KEY": "YOUR_OPENFDA_API_KEY"}}
```

这是服务器条目的附加字段，不是独立的完整客户端配置。密钥通过 HTTP Basic Authentication 发送，不加入返回的查询 URL。配额以官方文档为准。

## 可用工具

当前提供 **6 个工具**。参数使用严格校验，拒绝未声明字段；字符串会去除首尾空格并拒绝控制字符。数字参数使用 JSON 数字，布尔参数使用 JSON 布尔值。下表的默认值、必填项和边界与服务实际公布的 schema 一致。

### `search_drug_labels`

搜索药品标签，支持 openFDA 查询表达式、分页和字段统计；返回完整标签或 term/count 统计桶。

| 参数 | 类型 | 必填 | 默认值 | 描述与范围 |
| --- | --- | --- | --- | --- |
| `search` | string | 否 | `—` | openFDA 查询表达式，可包含字段名和布尔条件。 长度为 1–4000 个字符 |
| `count` | string | 否 | `—` | 统计字段，例如 openfda.manufacturer_name.exact。 长度为 1–200 个字符 |
| `skip` | integer | 否 | `0` | 跳过记录数，用于分页；统计查询须为 0。 ≥0; ≤25000 |
| `limit` | integer | 否 | `10` | 本次最多返回的记录或统计桶数量。 ≥1; ≤1000 |

调用示例（MCP `tools/call` 的参数）：

```json
{
  "name": "search_drug_labels",
  "arguments": {
    "search": "openfda.generic_name:aspirin",
    "limit": 3
  }
}
```

### `get_drug_adverse_reactions`

按通用名、商品名或成分名获取不良反应及禁忌原文，保留标签标识。

| 参数 | 类型 | 必填 | 默认值 | 描述与范围 |
| --- | --- | --- | --- | --- |
| `drug_name` | string | 是 | `—` | 英文药物通用名、商品名或成分名。 长度为 1–200 个字符 |
| `limit` | integer | 否 | `3` | 本次最多返回的记录或统计桶数量。 ≥1; ≤50 |

调用示例（MCP `tools/call` 的参数）：

```json
{
  "name": "get_drug_adverse_reactions",
  "arguments": {
    "drug_name": "ibuprofen",
    "limit": 3
  }
}
```

### `get_drug_warnings`

获取警告、注意事项、warnings_and_cautions 和黑框警告原文。

| 参数 | 类型 | 必填 | 默认值 | 描述与范围 |
| --- | --- | --- | --- | --- |
| `drug_name` | string | 是 | `—` | 英文药物通用名、商品名或成分名。 长度为 1–200 个字符 |
| `limit` | integer | 否 | `3` | 本次最多返回的记录或统计桶数量。 ≥1; ≤50 |

调用示例（MCP `tools/call` 的参数）：

```json
{
  "name": "get_drug_warnings",
  "arguments": {
    "drug_name": "ibuprofen",
    "limit": 3
  }
}
```

### `get_drug_indications`

获取适应症、用途及用法用量原文。

| 参数 | 类型 | 必填 | 默认值 | 描述与范围 |
| --- | --- | --- | --- | --- |
| `drug_name` | string | 是 | `—` | 英文药物通用名、商品名或成分名。 长度为 1–200 个字符 |
| `limit` | integer | 否 | `3` | 本次最多返回的记录或统计桶数量。 ≥1; ≤50 |

调用示例（MCP `tools/call` 的参数）：

```json
{
  "name": "get_drug_indications",
  "arguments": {
    "drug_name": "aspirin",
    "limit": 3
  }
}
```

### `get_drug_details`

按 set_id 获取生效日期最新的一条完整标签；可选择顶层字段，正文不截断。

| 参数 | 类型 | 必填 | 默认值 | 描述与范围 |
| --- | --- | --- | --- | --- |
| `set_id` | string | 是 | `—` | 检索结果中的标签集合 UUID。 |
| `fields` | string[] | 否 | `—` | 返回字段列表，省略或空数组表示全部。 maxItems=50 |

调用示例（MCP `tools/call` 的参数）：

```json
{
  "name": "get_drug_details",
  "arguments": {
    "set_id": "0058175f-3474-40c3-a046-6cfaec86d84b",
    "fields": [
      "indications_and_usage",
      "warnings"
    ]
  }
}
```

### `search_labels`

按药物名称和可选不良反应关键词检索四类安全章节。

| 参数 | 类型 | 必填 | 默认值 | 描述与范围 |
| --- | --- | --- | --- | --- |
| `drug` | string | 是 | `—` | 英文药物名称。 长度为 1–200 个字符 |
| `adr` | string | 否 | `—` | 可选不良反应搜索词。 长度为 1–200 个字符 |
| `limit` | integer | 否 | `5` | 本次最多返回的记录或统计桶数量。 ≥1; ≤20 |

调用示例（MCP `tools/call` 的参数）：

```json
{
  "name": "search_labels",
  "arguments": {
    "drug": "ibuprofen",
    "adr": "bleeding",
    "limit": 3
  }
}
```

## 返回结果与查询行为

MCP 响应的 `content` 中包含一个 `type: "text"` 项，其 `text` 是 JSON 字符串。所有成功结果均包含 `source` 和 `query_url`，分别标明数据源和主查询 URL。复合工具的其他请求链接在结果内保留。

| 工具 | 数据字段与行为 |
| --- | --- |
| `search_drug_labels` | `meta` 保留上游元数据；`results` 为完整原始标签并附 `url`。指定 `count` 时，`results` 为 `term` / `count` 统计桶，不进行标签投影。 |
| 三个章节工具 | `meta` 与 `results`；每条记录保留 `id`、`set_id`、`version`、`effective_time`、`openfda`、`url` 及存在的目标章节，章节原文不截断。 |
| `get_drug_details` | `set_id`、`drug_details`；默认返回完整标签，`fields` 非空时仅返回指定字段及身份字段、来源链接。找不到时 `drug_details` 为 `null`。 |
| `search_labels` | `records[].id/url/content/metadata`；`content` 为黑框警告、警告、不良反应和相互作用原文，带章节名称；`metadata` 包含 `set_id` 和 `effective_time`。 |

搜索和章节工具无结果时返回空数组。缺失章节不补造内容。标签条数不等于不同药物的数量，同一药物可有不同厂商和版本。普通检索的 `meta.results` 提供上游的 `total`、`skip` 和 `limit`；统计查询的元数据结构由上游决定。

`drug_name` 查询通用名、商品名或成分名；`search_labels.drug` 查询通用名或商品名，`adr` 仅筛选 `adverse_reactions` 字段。名称值会加引号，输入中的双引号和反斜杠替换为空格；`search_drug_labels.search` 则直接使用 openFDA 查询语法。`count` 与非零 `skip` 不可同时使用。`fields` 省略或为空数组时返回完整标签；未存在的指定字段会跳过。

## 使用示例

连接后可以向助手提出：

> 检索 ibuprofen 的警告和不良反应，保留标签来源；再用结果中的 set_id 获取完整标签。

返回信息用于检索与研究辅助；临床判断需结合具体产品、研究设计和个人情况，本项目不提供个人诊疗建议。

## 数据来源

每次调用访问官方 `GET https://api.fda.gov/drug/label.json`。此项目检索药品标签，未查询 FAERS 个例报告。没有本地标签数据库或结果缓存。请参阅 [字段参考](https://open.fda.gov/apis/drug/label/searchable-fields/)和 [openFDA 使用条款](https://open.fda.gov/terms/)。

## 错误处理与故障排查

工具执行失败时返回 `isError: true`，文本 JSON 结构如下：

```json
{"error":{"code":"invalid_arguments","message":"…","retryable":false}}
```

每次上游请求默认超时 30 秒，不自动重试；复合工具可能执行多次请求。`retryable` 提示调用方稍后是否适合重试。

| 情况 / 错误码 | 处理方法 |
| --- | --- |
| 工具缺失或连接关闭 | 确认 Node.js ≥22，执行构建，检查绝对路径，并重新加载客户端。 |
| `invalid_arguments` | 检查必填项、类型、范围及枚举，删除额外参数。 |
| `unknown_tool` | 重新加载工具列表并使用上文工具名。 |
| `network / timeout` | 检查服务器能否访问 api.fda.gov，稍后重试。 |
| `http_429 / http_5xx` | 降低请求频率，等待上游恢复。 |
| `http_400 / http_401 / http_403` | 检查查询表达式、凭据及上游访问条件。 |
| `http_404` | 检查记录标识；搜索无匹配按各工具的空结果规则处理。 |
| `invalid_json / invalid_response` | 上游响应格式异常，持续出现时附错误码提交 Issue。 |
| `cancelled` | 客户端取消了请求，需要时重新发起。 |
| `internal / configuration` | 检查安装与本地改动，附运行环境和错误信息反馈。 |

## 从源码运行

```bash
npm run build
npm start
npm run dev
```

上述命令分别用于构建、启动构建产物和直接运行 TypeScript 源码。

## 反馈与许可证

通过 [GitHub Issues](https://github.com/Aki894/mcp-openfda/issues) 反馈问题，请提供 Node.js 版本、MCP 客户端、工具参数及错误码，移除密钥和个人信息。

代码采用 [GPL-3.0](LICENSE)。数据来源条款单独适用。

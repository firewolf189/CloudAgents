---
name: quant-cc
description: A股/港股/美股量化交易系统 cc_quant_system 的操作技能。覆盖数据更新、模拟盘运行、交易指引查看、个股查询、板块查询、回测、策略管理等全部核心功能。当用户提到以下场景时触发：(1) 更新股票数据、拉行情、更新K线，(2) 跑模拟盘、运行模拟交易、模拟盘状态，(3) 查看明日指引、今日持仓、交易记录、明天买什么，(4) 查询个股行情、K线、基本面、策略信号，(5) 查询板块、行业、成分股，(6) 回测策略、对比策略、查看回测历史，(7) 分析策略代码、创建新策略，(8) 启动/停止 Web 服务，(9) 龙虎榜、南向资金、研报数据，(10) 港股、美股、A股数据和策略，(11) 海龟策略、动量策略，(12) 提到 cc_quant、量化系统、股票数据等关键词。
---

# 量化交易系统 (cc_quant_system)

支持 A股 / 港股 / 美股 三市场，含数据管理、策略回测、模拟盘、Web仪表盘。

## 环境

- 项目目录: `/Users/chencheng/Documents/量化交易/cc_quant_system`
- Python: `/Users/chencheng/miniforge3/bin/python3`
- 所有命令需先 `cd /Users/chencheng/Documents/量化交易/cc_quant_system` 再执行
- 数据库: `data/stock_data.db` (SQLite)
- Web: `http://127.0.0.1:5051`

## CLI 命令速查

所有操作通过 `python3 manage.py <command>` 执行：

```
# 数据更新
update --inc                   一键更新所有市场（A股K线+龙虎榜+研报 + 港股K线+南向 + 美股K线）
update --market cn             A股全量（K线+龙虎榜+研报）
update --market hk             港股（K线+南向资金）
update --market us             美股（K线）
lhb --inc                      单独更新龙虎榜
southbound --update            单独更新南向资金
research --update              单独更新研报数据

# 模拟盘（多账户，支持A/港/美）
sim                            跑所有启用的账户（最新日期）
sim -a sim_hk                  只跑指定账户
sim --from 2026-05-08          从某天批量跑到最新
sim --from 2026-05-08 -a sim_us  指定账户+起始日期
sim --update                   更新A股数据后跑模拟盘
sim-status                     所有账户概览
sim-status -a flow_a_sim       单账户详情

# 个股与板块
stock <代码>                   查A股个股（如 stock 600519）
stock <代码> --market hk       查港股（如 stock 00700 --market hk）
stock <代码> --market us       查美股（如 stock AAPL --market us）
search <关键词>                搜索股票
sectors                        查看全部A股板块
sectors <板块名>               查看板块成分股

# 龙虎榜 & 南向资金
lhb                            龙虎榜最新数据/状态
lhb --inc                      增量更新
lhb <日期>                     查指定日期
lhb <代码>                     查个股上榜历史
southbound                     南向资金净流入/流出TOP
southbound --update            更新数据
southbound <代码>              查个股南向资金历史

# 研报
research --update              更新全市场研报快照
research <代码>                查个股研报列表

# Web 服务
start                          启动仪表盘(端口5051)
stop                           停止
restart                        重启
status                         查看运行状态
```

## 功能路由

根据用户意图选择对应命令：

| 用户说 | 执行命令 |
|---|---|
| 更新数据/拉行情/更新所有 | `python3 manage.py update --inc` |
| 更新A股 | `python3 manage.py update --market cn` |
| 更新港股 | `python3 manage.py update --market hk` |
| 更新美股 | `python3 manage.py update --market us` |
| 跑模拟盘 | `python3 manage.py sim` |
| 跑港股模拟盘 | `python3 manage.py sim -a sim_hk` |
| 跑美股模拟盘 | `python3 manage.py sim -a sim_us` |
| 从某天开始跑模拟盘 | `python3 manage.py sim --from 2026-05-08` |
| 看模拟盘状态/持仓/指引 | `python3 manage.py sim-status` |
| 看某个账户详情 | `python3 manage.py sim-status -a flow_a_sim` |
| 查A股个股 | `python3 manage.py stock 600519` |
| 查港股个股 | `python3 manage.py stock 00700 --market hk` |
| 查美股个股 | `python3 manage.py stock AAPL --market us` |
| 搜索股票 | `python3 manage.py search 茅台` |
| 查板块成分股 | `python3 manage.py sectors 白酒` |
| 更新龙虎榜 | `python3 manage.py lhb --inc` |
| 看龙虎榜 | `python3 manage.py lhb` |
| 看南向资金 | `python3 manage.py southbound` |
| 更新研报 | `python3 manage.py research --update` |
| 查研报 | `python3 manage.py research 600519` |
| 启动Web | `python3 manage.py start` |
| 看回测/对比策略 | 启动Web后访问 `http://127.0.0.1:5051/backtest` |

## 模拟盘账户

当前启用的模拟盘账户（通过Web页面 `/sim` 管理）：

| 账户 | 市场 | 策略 |
|------|------|------|
| flow_a_sim | A股 | momentum_v38best_20d_flow_a (板块资金+龙头排名) |
| sim_lhb | A股 | momentum_v38best_20d_flow_lhb (龙虎榜增强) |
| sim_lhb_yanbao | A股 | momentum_v38best_20d_flow_lhb_res (龙虎榜+研报) |
| sim_hk | 港股 | hk_momentum (港股动量趋势) |
| sim_us | 美股 | us_momentum (美股动量趋势) |

账户配置存数据库 `sim_accounts` 表，通过Web页面增删改，每个账户独立资金/佣金/策略。

## 策略列表

### A股策略
- `momentum_v38best_20d_flow_a` — ⭐新基准：板块资金+龙头排名
- `momentum_v38best_20d_flow_lhb` — ⭐⭐龙虎榜增强版（回测最优）
- `momentum_v38best_20d_flow_lhb_res` — ⭐⭐⭐龙虎榜+研报增强版
- `turtle_classic` — 海龟经典版（纯趋势跟踪）
- `turtle_pro` — 海龟改良版（突破+动量过滤）
- 其他 V20~V42 系列历史版本

### 港股策略
- `hk_momentum` — 港股动量趋势（突破+量价+均线）
- `hk_momentum_sb` — 港股动量+南向资金增强

### 美股策略
- `us_momentum` — 美股动量趋势（突破+量价，T+0）

## 策略信号查询

当用户问"某股票有信号吗"、"今日选股"等需要运行策略的场景：

```python
import sys
sys.path.insert(0, "/Users/chencheng/Documents/量化交易/cc_quant_system")
import sqlite3, pandas as pd
from config.settings import DB_PATH
from signals.generator import STRATEGY_MAP

conn = sqlite3.connect(DB_PATH)
target_date = conn.execute("SELECT MAX(date) FROM daily_kline").fetchone()[0]
lookback_date = (pd.Timestamp(target_date) - pd.Timedelta(days=120)).strftime("%Y-%m-%d")
df = pd.read_sql_query(
    "SELECT * FROM daily_kline WHERE date>=? AND date<=? ORDER BY symbol, date",
    conn, params=(lookback_date, target_date))
conn.close()

strategy = STRATEGY_MAP['momentum_v38best_20d_flow_lhb']('query', {})
signals = strategy.generate_signals(df)
today = signals[signals['date'] == target_date]
buys = today[today['signal'] == 1].sort_values('total_score', ascending=False)
```

港美股信号查询改用对应的K线表和策略：
```python
# 港股
df = pd.read_sql_query("SELECT * FROM hk_daily_kline WHERE ...", conn)
strategy = STRATEGY_MAP['hk_momentum']('query', {})

# 美股
df = pd.read_sql_query("SELECT * FROM us_daily_kline WHERE ...", conn)
strategy = STRATEGY_MAP['us_momentum']('query', {})
```

## 数据库表结构

### 核心表
| 表 | 说明 |
|---|---|
| daily_kline | A股日K线 |
| hk_daily_kline | 港股日K线 |
| us_daily_kline | 美股日K线 |
| stock_info | A股信息（代码/名称/行业） |
| hk_stock_info | 港股信息（520只港股通） |
| us_stock_info | 美股信息（160只活跃美股） |
| lhb_stocks / lhb_seats | A股龙虎榜 |
| hk_southbound | 南向资金每日持股 |
| research_coverage | 研报覆盖度快照 |
| sim_accounts | 模拟盘账户配置 |
| sim_account / sim_positions / sim_trades | 模拟盘运行数据 |
| sim_instructions | 操作指引历史 |
| backtest_runs / trades / account_snapshots | 回测数据 |

### 数据量
- A股: ~5500只, 1467万条K线 (2005-至今)
- 港股: ~520只, 155万条K线 (1998-至今)
- 美股: ~160只, 51万条K线 (1972-至今)

## Web 页面

| 路径 | 功能 |
|---|---|
| `/` | 仪表盘首页 |
| `/stock/<symbol>?market=hk` | 个股详情（支持A/港/美） |
| `/sim` | 模拟盘账户列表（多账户管理） |
| `/sim/<run_name>` | 单账户详情 |
| `/backtest` | 回测中心 |
| `/compare` | 策略对比回测 |
| `/strategies` | 策略列表 |
| `/strategies/<key>` | 策略详情 |
| `/lhb` | A股龙虎榜 |
| `/southbound` | 南向资金（港股龙虎榜） |

## 交易规则差异

| | A股 | 港股 | 美股 |
|---|---|---|---|
| T+N | T+1 | T+0 | T+0 |
| 涨跌停 | 有 | 无 | 无 |
| 最小单位 | 100股 | 1股 | 1股 |
| 佣金 | 万2.5+千1税 | 千1+千1.3税 | 零佣金 |

## 策略管理

- 策略文件: `strategies/*.py`，继承 `BaseStrategy`
- 策略注册: `signals/generator.py` 的 `STRATEGY_MAP`
- 策略配置: `config/strategies.json`
- 策略的 `MARKET` 属性决定使用哪个市场的数据和交易规则
- 策略的 `CUSTOM_STOP_LOSS = True` 声明自管止损（跳过系统-7%止损）

# 数据库表结构

数据库路径: `/Users/chencheng/Documents/量化交易/cc_quant_system/data/stock_data.db`

## daily_kline (日K线)

| 字段 | 类型 | 说明 |
|---|---|---|
| symbol | TEXT | 股票代码 (如 000001) |
| date | TEXT | 日期 (YYYY-MM-DD) |
| open | REAL | 开盘价 |
| close | REAL | 收盘价 |
| high | REAL | 最高价 |
| low | REAL | 最低价 |
| volume | REAL | 成交量 (股) |
| amount | REAL | 成交额 (元) |
| amplitude | REAL | 振幅 (%) |
| pct_change | REAL | 涨跌幅 (%) |
| turnover | REAL | 换手率 (小数, 0.01=1%) |

主键: (symbol, date)。索引: idx_daily_kline_date, idx_daily_kline_symbol

查询优化提示: `SELECT MIN/MAX(date)` 用子查询 `SELECT (SELECT MAX(date) FROM daily_kline)` 避免全表扫描。

## stock_info (股票信息)

| 字段 | 类型 | 说明 |
|---|---|---|
| symbol | TEXT PK | 股票代码 |
| name | TEXT | 股票名称 |
| industry | TEXT | 行业板块 |
| market | TEXT | 市场 (主板/创业板/科创板/北交所) |
| market_cap | REAL | 总市值 |
| status | TEXT | 上市状态 (L=上市) |
| delist_date | TEXT | 退市日期 |

## sim_account (模拟盘账户快照)

| 字段 | 类型 | 说明 |
|---|---|---|
| run_name | TEXT | 策略运行名 (如 flow_a_sim) |
| date | TEXT | 日期 |
| total_value | REAL | 总资产 |
| cash | REAL | 现金 |
| market_value | REAL | 持仓市值 |
| daily_pnl | REAL | 当日盈亏 |

主键: (run_name, date)

## sim_positions (模拟盘持仓)

| 字段 | 类型 | 说明 |
|---|---|---|
| run_name | TEXT | 策略运行名 |
| symbol | TEXT | 股票代码 |
| shares | REAL | 持仓股数 |
| cost | REAL | 成本价 (含滑点) |
| buy_date | TEXT | 买入日期 |
| buy_price | REAL | 买入价格 |

主键: (run_name, symbol)

## sim_trades (模拟盘交易记录)

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | 自增ID |
| run_name | TEXT | 策略运行名 |
| date | TEXT | 交易日期 |
| symbol | TEXT | 股票代码 |
| action | TEXT | buy/sell |
| price | REAL | 成交价 |
| shares | REAL | 股数 |
| amount | REAL | 金额 |
| commission | REAL | 佣金 |
| tax | REAL | 印花税 |
| pnl | REAL | 盈亏 (卖出时) |
| reason | TEXT | 原因 |

## sim_instructions (操作指引历史)

| 字段 | 类型 | 说明 |
|---|---|---|
| run_name | TEXT | 策略运行名 |
| date | TEXT | 日期 |
| market_state | TEXT | 市场状态 (强势/弱势/熊市) |
| max_positions | INTEGER | 最大持仓数 |
| content | TEXT | JSON指引内容 |

content JSON 结构:
```json
{
  "today_executed": {
    "buy": [{"symbol":"300819","name":"聚杰微纤","price":82.44,"shares":500,"pnl":0,"reason":"..."}],
    "sell": [{"symbol":"...","name":"...","price":...,"shares":...,"pnl":...,"reason":"..."}]
  },
  "tomorrow_plan": {
    "buy": [{"symbol":"...","name":"...","sector":"...","price":...,"limit_price":...,"shares":...,"amount":...,"score":...,"reason":"..."}],
    "sell": [{"symbol":"...","name":"...","shares":...,"cost":...,"price":...,"limit_price":...,"pnl_pct":...,"reason":"..."}],
    "keep": [{"symbol":"...","name":"...","shares":...,"cost":...,"price":...,"pnl_pct":...,"reason":"..."}]
  }
}
```

主键: (run_name, date)

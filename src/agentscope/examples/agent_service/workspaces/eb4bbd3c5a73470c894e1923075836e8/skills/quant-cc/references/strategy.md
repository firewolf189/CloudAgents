# 策略结构

## 文件位置

策略文件: `/Users/chencheng/Documents/量化交易/cc_quant_system/strategies/momentum_*.py`
策略配置: `/Users/chencheng/Documents/量化交易/cc_quant_system/config/strategies.json`
策略注册: `/Users/chencheng/Documents/量化交易/cc_quant_system/signals/generator.py` 的 `STRATEGY_MAP`

## 策略基类

所有策略继承 `strategies.base.BaseStrategy`，必须实现：

```python
class MyStrategy(BaseStrategy):
    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        """输入K线数据，输出添加了signal列的DataFrame。signal=1买入"""
        pass

    def check_sell(self, symbol, row, position, market_state) -> (bool, str):
        """判断是否卖出。返回(是否卖出, 原因)"""
        pass

    def get_max_positions(self, market_state) -> int:
        """根据市场状态返回最大持仓数"""
        pass

    def get_position_ratio(self) -> float:
        """单只股票占现金的比例"""
        pass
```

## 当前主力策略: momentum_v38best_20d_flow_a

核心逻辑:
1. 大盘趋势过滤（MA120/MA200）
2. 板块资金流向检测（volume_ratio × pct_change）
3. 板块内龙头排名加分（W_INNER_RANK=5）
4. 量价共振评分（MLV权重100，最高）
5. T+1执行：今天选出，明天开盘买入
6. 板块联动动态持有2~10天

关键参数:
- HARD_STOP_PCT: -7% 硬止损
- MAX_POSITIONS_FULL: 7只（牛市）
- MAX_POSITIONS_HALF: 4只（震荡）
- get_position_ratio: 15%（牛市）/ 10%（震荡）/ 5%（熊市）
- SECTOR_WEIGHT: 0.30 板块加成

## 模拟盘配置

文件: `sim/config.py`

```python
SIM_CONFIGS = [
    {"key": "momentum_v38best_20d_flow_a", "name": "flow_a_sim", "capital": 300000, "enabled": True},
]
COMMISSION_RATE = 0.00025  # 万2.5佣金
STAMP_TAX_RATE = 0.001     # 千1印花税（卖出）
SLIPPAGE = 0.0015          # 0.15%滑点
```

## 注册新策略

1. 在 `strategies/` 创建策略文件
2. 在 `signals/generator.py` 添加 import 和 STRATEGY_MAP 条目
3. 在 `config/strategies.json` 添加配置

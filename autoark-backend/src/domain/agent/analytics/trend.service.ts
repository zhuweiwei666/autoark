import logger from '../../../utils/logger'

/**
 * 趋势分析服务
 * 提供指标平滑处理 (EMA) 和动能分析 (Slope/Derivatives)
 */
export class TrendService {
  /**
   * 指数移动平均 (EMA)
   * 用于平滑原始 API 数据中的毛刺
   * @param sequence 原始指标序列 (从旧到新)
   * @param alpha 平滑因子 (0-1, 越小越平滑, 默认 0.3)
   */
  calculateEMA(sequence: number[], alpha: number = 0.3): number[] {
    if (sequence.length === 0) return []
    const result: number[] = [sequence[0]]
    for (let i = 1; i < sequence.length; i++) {
      const ema = alpha * sequence[i] + (1 - alpha) * result[i - 1]
      result.push(ema)
    }
    return result
  }

  /**
   * 计算指标斜率 (一阶导数)
   * 使用简单线性回归拟合，判断指标在“变好”还是“变坏”
   * @param sequence 已平滑的指标序列 (从旧到新)
   * @returns 斜率 m (每单位步长的变化量)
   */
  calculateSlope(sequence: number[]): number {
    const n = sequence.length
    if (n < 2) return 0

    // 计算 x 和 y 的均值
    // x 为步长 [0, 1, 2, ..., n-1]
    const xSum = (n * (n - 1)) / 2
    const ySum = sequence.reduce((a, b) => a + b, 0)
    
    // 计算最小二乘法斜率
    let num = 0
    let den = 0
    const yMean = ySum / n
    const xMean = xSum / n

    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (sequence[i] - yMean)
      den += (i - xMean) ** 2
    }

    // 防止除以 0
    if (den === 0) return 0
    
    return num / den
  }

  /**
   * 计算趋势增益系数
   * 如果指标在向好的方向发展 (如 CTR 升, CPA 降), 则提供加分
   * @param slope 斜率
   * @param direction 预期方向 (1: 越高越好, -1: 越低越好)
   * @param sensitivity 敏感度 (默认 0.1)
   */
  getTrendMultiplier(slope: number, direction: 1 | -1, sensitivity: number = 0.1): number {
    // 动能分 = 斜率 * 预期方向 * 敏感度
    // 例如: CTR 斜率为 0.01 (上升), 预期方向 1, 敏感度 10 -> 0.1 加分 (10% 动能增益)
    const momentum = slope * direction * sensitivity
    
    // 限制增益在 [-0.5, 0.5] 之间，防止过度波动
    return Math.max(-0.5, Math.min(0.5, momentum))
  }

  /**
   * 计算二阶导数 (加速度)
   * 用于预判衰退：如果斜率在减小，说明动能正在枯竭
   */
  calculateAcceleration(sequence: number[]): number {
    if (sequence.length < 3) return 0
    
    // 取最近一段的两个斜率
    const mid = Math.floor(sequence.length / 2)
    const slope1 = this.calculateSlope(sequence.slice(0, mid + 1))
    const slope2 = this.calculateSlope(sequence.slice(mid))
    
    return slope2 - slope1
  }
}

export const trendService = new TrendService()

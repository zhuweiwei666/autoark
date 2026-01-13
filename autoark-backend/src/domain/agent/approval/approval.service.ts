/**
 * Agent 审批服务
 * 处理操作的审批和拒绝流程
 */

import { AgentConfig, AgentOperation } from '../agent.model'
import { feishuService } from '../../../services/feishu.service'
import logger from '../../../utils/logger'

class ApprovalService {
  /**
   * 获取待审批的操作列表
   */
  async getPendingOperations(filters: any = {}): Promise<any[]> {
    return AgentOperation.find({ status: 'pending', ...filters })
      .populate('agentId')
      .sort({ createdAt: -1 })
  }

  /**
   * 批准操作
   * @param operationId 操作ID
   * @param userId 审批人ID
   * @param executeOperation 执行操作的回调函数
   */
  async approveOperation(
    operationId: string, 
    userId: string,
    executeOperation: (opId: string, agent: any) => Promise<any>
  ): Promise<any> {
    const operation: any = await AgentOperation.findById(operationId)
    if (!operation) {
      return { success: false, error: 'Operation not found' }
    }
    
    operation.status = 'approved'
    await operation.save()

    // 如果是通过非飞书渠道审批的，尝试同步更新飞书卡片状态
    if (operation.feishuMessageId && !userId.startsWith('feishu:')) {
      const agent = await AgentConfig.findById(operation.agentId)
      if (agent) {
        feishuService.updateApprovalCard(operation.feishuMessageId, 'approved', userId, agent).catch(() => {})
      }
    }
    
    // 执行操作
    const agent = await AgentConfig.findById(operation.agentId)
    return executeOperation(operationId, agent)
  }

  /**
   * 拒绝操作
   */
  async rejectOperation(operationId: string, userId: string, reason?: string): Promise<any> {
    const operation: any = await AgentOperation.findById(operationId)
    if (operation?.feishuMessageId && !userId.startsWith('feishu:')) {
      const agent = await AgentConfig.findById(operation.agentId)
      if (agent) {
        feishuService.updateApprovalCard(operation.feishuMessageId, 'rejected', userId, agent).catch(() => {})
      }
    }

    return AgentOperation.findByIdAndUpdate(operationId, {
      status: 'rejected',
      executedBy: userId,
      error: reason || 'Rejected by user',
    }, { new: true })
  }
}

export const approvalService = new ApprovalService()

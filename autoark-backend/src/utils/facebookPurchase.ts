/**
 * Facebook Purchase Value 提取工具函数
 * 
 * 支持多种 Facebook 购买事件类型：
 * - purchase (标准购买)
 * - mobile_app_purchase (移动应用内购买)
 * - offsite_conversion.fb_pixel_purchase (Pixel 购买)
 * - onsite_conversion.purchase (站内转化购买)
 * - onsite_conversion.purchase.mobile_app (站内转化移动应用购买)
 * 
 * @param actionValues Facebook API 返回的 action_values 数组
 * @returns 提取的 purchase value（数字），如果未找到则返回 0
 */
export const extractPurchaseValue = (actionValues: any[]): number => {
  if (!Array.isArray(actionValues)) return 0;

  const PURCHASE_TYPES = [
    "purchase",
    "mobile_app_purchase",
    "offsite_conversion.fb_pixel_purchase",
    "onsite_conversion.purchase",
    "onsite_conversion.purchase.mobile_app"
  ];

  for (const type of PURCHASE_TYPES) {
    const row = actionValues.find(a => a.action_type === type);
    if (row && row.value) return parseFloat(row.value) || 0;
  }

  return 0;
};


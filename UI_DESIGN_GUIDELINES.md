# AutoArk UI 设计规范

## 📐 设计系统概述

AutoArk 采用**苹果液态玻璃风格**，提供优雅、现代、高性能的用户体验。

---

## 🎨 核心设计原则

### 1. 液态玻璃质感
- 半透明背景 (`rgba(255, 255, 255, 0.95)`)
- 模糊效果 (`backdrop-filter: blur(20px)`)
- 内发光高光 (`inset 0 1px rgba(255, 255, 255, 0.8)`)
- 柔和阴影 (`0 8px 32px rgba(0, 0, 0, 0.08)`)

### 2. 流畅动画
- 统一过渡时间：250ms
- 缓动函数：`cubic-bezier(0.4, 0, 0.2, 1)`
- 微动效：悬浮上浮 2px，按压缩放 0.98

### 3. 颜色体系
```
主色调 (蓝)：#3b82f6 → #6366f1 (渐变)
成功 (绿)：#10b981 → #059669
危险 (红)：#ef4444 → #dc2626
警告 (橙)：#f59e0b → #d97706
次要 (灰)：#f8fafc → #f1f5f9
```

---

## 🔲 组件使用规范

### **1. 按钮系统**

#### 主要操作按钮
```tsx
<button className="btn btn-primary">
  确认操作
</button>
// 或使用 Tailwind（自动应用液态玻璃）
<button className="px-6 py-3 bg-blue-600 text-white rounded-xl">
  确认操作
</button>
```

#### 次要/取消按钮
```tsx
<button className="btn btn-secondary">
  取消
</button>
```

#### 危险操作
```tsx
<button className="btn btn-danger">
  删除
</button>
```

#### 加载状态按钮
```tsx
<button className="btn btn-primary" disabled={loading}>
  {loading ? (
    <>
      <Loading.Spinner size="sm" color="white" />
      处理中...
    </>
  ) : (
    '提交'
  )}
</button>
```

---

### **2. Loading 状态**

**统一使用 `Loading` 组件库，禁止自定义 spinner！**

#### 表格加载
```tsx
import Loading from '../components/Loading'

{loading ? (
  <tr><td colSpan={columns}>
    <Loading.Inline message="加载数据..." size="md" />
  </td></tr>
) : (
  // 渲染数据
)}
```

#### 页面加载
```tsx
{loading ? (
  <Loading.Overlay message="加载中..." size="md" />
) : (
  // 渲染内容
)}
```

#### 全屏加载（带进度）
```tsx
{processing && (
  <Loading.FullScreen 
    message="处理中..." 
    description="正在上传文件..."
    progress={uploadProgress}
  />
)}
```

#### 内联加载指示器
```tsx
<div className="flex items-center gap-2">
  <Loading.Spinner size="sm" color="blue" />
  <span>同步中...</span>
</div>
```

#### 空状态
```tsx
{data.length === 0 && (
  <Loading.Empty 
    title="暂无数据" 
    description="请先创建一些内容"
    action={{
      label: "创建",
      onClick: () => handleCreate()
    }}
  />
)}
```

---

### **3. 消息提示**

#### 成功消息
```tsx
<div className="p-5 rounded-3xl border bg-emerald-50 border-emerald-200 text-emerald-800 animate-fade-in">
  <div className="flex items-center gap-3">
    <svg className="w-5 h-5">✓</svg>
    <span className="font-medium">操作成功！</span>
  </div>
</div>
```

#### 错误消息
```tsx
<div className="p-5 rounded-3xl border bg-red-50 border-red-200 text-red-800">
  <div className="flex items-center gap-3">
    <svg className="w-5 h-5">⚠</svg>
    <span className="font-medium">操作失败：{error}</span>
  </div>
</div>
```

---

### **4. 卡片容器**

```tsx
<div className="bg-white rounded-3xl p-6 shadow-lg shadow-black/5 border border-slate-200">
  {/* 内容 */}
</div>
```

#### 玻璃卡片（用于悬浮元素）
```tsx
<div className="glass-loading-card p-8">
  {/* 内容 */}
</div>
```

---

### **5. 表单输入**

#### 输入框
```tsx
<input 
  type="text"
  className="w-full px-4 py-3 bg-white border border-slate-300 rounded-2xl 
             focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 
             transition-all shadow-sm"
  placeholder="请输入..."
/>
```

#### 下拉框
```tsx
<select 
  className="w-full px-4 py-3 bg-white border border-slate-300 rounded-2xl 
             focus:outline-none focus:ring-2 focus:ring-blue-400 
             transition-all appearance-none cursor-pointer shadow-sm"
>
  <option value="">请选择</option>
</select>
```

---

### **6. 表格**

```tsx
<table className="w-full text-sm">
  <thead>
    <tr className="border-b border-slate-200 bg-slate-50">
      <th className="px-6 py-5 font-semibold text-slate-900">列名</th>
    </tr>
  </thead>
  <tbody>
    <tr className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
      <td className="px-6 py-4 text-slate-700">数据</td>
    </tr>
  </tbody>
</table>
```

---

## 🚫 **禁止使用**

❌ **自定义 spinner HTML**
```tsx
// ❌ 禁止
<div className="animate-spin ...">...</div>

// ✅ 使用
<Loading.Spinner size="md" color="blue" />
```

❌ **不一致的圆角**
```tsx
// ❌ 禁止
className="rounded-lg"  // 旧风格

// ✅ 使用
className="rounded-2xl" // 统一大圆角
className="rounded-3xl" // 超大圆角（卡片）
```

❌ **硬编码 Loading 文本**
```tsx
// ❌ 禁止
<div>加载中...</div>

// ✅ 使用
<Loading.Inline message="加载中..." />
```

❌ **不带过渡的状态变化**
```tsx
// ❌ 禁止
<button className="bg-blue-500">

// ✅ 使用（自动应用过渡）
<button className="bg-blue-600">  // Tailwind 类会自动应用液态玻璃效果
```

---

## 📏 **布局规范**

### 页面结构
```tsx
<div className="min-h-screen bg-white p-6">
  <div className="max-w-7xl mx-auto space-y-6">
    {/* 头部 */}
    <header className="bg-white rounded-3xl p-6 shadow-lg border border-slate-200">
      <h1 className="text-3xl font-bold text-slate-900">页面标题</h1>
    </header>
    
    {/* 内容区 */}
    <section className="bg-white rounded-3xl p-6 shadow-lg border border-slate-200">
      {/* ... */}
    </section>
  </div>
</div>
```

### 间距系统
- 页面边距：`p-6`
- 区块间距：`space-y-6`
- 内部间距：`gap-4` / `gap-6`
- 卡片内边距：`p-6` / `p-8`

---

## 🎯 **新增页面检查清单**

创建新页面时，请确保：

- [ ] 导入 `Loading` 组件
- [ ] 所有加载状态使用 `Loading.*` 组件
- [ ] 按钮使用 Tailwind `bg-blue-600` 等类（自动液态玻璃）
- [ ] 圆角使用 `rounded-2xl` 或 `rounded-3xl`
- [ ] 卡片使用 `shadow-lg shadow-black/5`
- [ ] 输入框使用 `focus:ring-2 focus:ring-blue-400`
- [ ] 过渡效果添加 `transition-all`
- [ ] 消息提示使用 `animate-fade-in`
- [ ] 空状态使用 `Loading.Empty`
- [ ] 错误处理统一样式

---

## 📦 **可用组件库**

| 组件 | 导入路径 |
|------|---------|
| Loading | `import Loading from '../components/Loading'` |
| DatePicker | `import DatePicker from '../components/DatePicker'` |
| Button | `import { Button } from '../components/Button'` |
| Skeleton | `import { Skeleton } from '../components/Skeleton'` |

---

## 🔧 **CSS 工具类**

### 自定义类
- `.glass-card` - 玻璃卡片
- `.glass-loading-card` - 加载卡片
- `.btn-primary` - 主按钮
- `.btn-secondary` - 次要按钮
- `.skeleton` - 骨架屏动画
- `.animate-fade-in` - 淡入动画

### Tailwind 增强
所有 Tailwind 按钮类（如 `bg-blue-600`）会自动应用液态玻璃效果，无需额外配置！

---

## 📸 **设计参考**

参考现有页面的实现：
- **最佳范例**：`FacebookCampaignsPage.tsx`
- **按钮范例**：`BulkAdCreatePage.tsx`
- **Loading 范例**：`MaterialMetricsPage.tsx`
- **表格范例**：`FacebookAccountsPage.tsx`

---

## 🎓 **代码示例模板**

### 完整页面模板
```tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Loading from '../components/Loading'
import { getData } from '../services/api'

export default function MyPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['myData'],
    queryFn: getData,
  })

  if (isLoading) {
    return <Loading.Page message="加载中..." />
  }

  return (
    <div className="min-h-screen bg-white p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* 头部 */}
        <header className="bg-white rounded-3xl p-6 shadow-lg border border-slate-200">
          <h1 className="text-3xl font-bold text-slate-900">我的页面</h1>
        </header>
        
        {/* 内容 */}
        <section className="bg-white rounded-3xl p-6 shadow-lg border border-slate-200">
          {data?.length === 0 ? (
            <Loading.Empty 
              title="暂无数据" 
              description="开始创建您的第一条记录"
            />
          ) : (
            <div>{/* 数据展示 */}</div>
          )}
        </section>
      </div>
    </div>
  )
}
```

---

## ⚡ 性能优化

1. **使用 React Query** 管理数据获取（已配置全局缓存）
2. **使用 Summary API** 而非 Facebook API（快 10-100 倍）
3. **避免不必要的重渲染**（使用 `useMemo`, `useCallback`）
4. **懒加载图片**（使用 `loading="lazy"`）

---

## ✅ **验收标准**

新页面必须通过：
- [ ] 视觉统一：与现有页面风格一致
- [ ] Loading 统一：使用 Loading 组件
- [ ] 按钮统一：液态玻璃效果
- [ ] 响应式：支持常见屏幕尺寸
- [ ] 无性能问题：首次加载 < 2秒
- [ ] 无 TypeScript 错误
- [ ] 无 Console 警告

---

**最后更新：2025-12-08**
**维护者：请严格遵守此规范，确保 UI 一致性！**

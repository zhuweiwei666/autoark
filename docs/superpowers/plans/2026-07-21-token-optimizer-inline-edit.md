# Token Optimizer Inline Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent, row-level optimizer editing to the Token list on the current “Token 与像素” page.

**Architecture:** Reuse the existing authenticated `updateToken` API and backend optimizer validation. Keep edit state local to `FacebookSettingsPage`, submit a trimmed string (including an empty string for clearing), then refetch the existing React Query token list after a successful save.

**Tech Stack:** React 18, TypeScript, TanStack Query, Node test runner, Vite.

---

## File map

- Create `autoark-frontend/tests/facebook-settings-optimizer.test.mjs`: source-level UI contract regression for the current settings page.
- Modify `autoark-frontend/src/pages/FacebookSettingsPage.tsx`: editing state, save/cancel handlers, inline input, and row actions.
- No backend production change: `PUT /api/fb-token/:id` already scopes access, sanitizes optimizer text, accepts clearing, and returns the updated Token.

### Task 1: Add the failing optimizer-edit regression

**Files:**
- Create: `autoark-frontend/tests/facebook-settings-optimizer.test.mjs`
- Test: `autoark-frontend/tests/facebook-settings-optimizer.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const pageSource = readFileSync(
  new URL('../src/pages/FacebookSettingsPage.tsx', import.meta.url),
  'utf8',
)

const sourceBetween = (source, start, end) => {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`)
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

test('settings page saves a trimmed optimizer and can clear it', () => {
  const saveSource = sourceBetween(
    pageSource,
    'const handleSaveOptimizer',
    '// Pixel 操作',
  )

  assert.match(pageSource, /updateToken/)
  assert.match(saveSource, /optimizer:\s*editOptimizer\.trim\(\)/)
  assert.doesNotMatch(saveSource, /trim\(\)\s*\|\|\s*undefined/)
  assert.match(saveSource, /await refetchTokens\(\)/)
  assert.match(saveSource, /setEditingTokenId\(null\)/)
})

test('settings page exposes accessible save and cancel controls', () => {
  assert.match(pageSource, /maxLength=\{80\}/)
  assert.match(pageSource, /e\.key === 'Enter'/)
  assert.match(pageSource, /e\.key === 'Escape'/)
  assert.match(pageSource, /aria-label="保存优化师"/)
  assert.match(pageSource, /aria-label="取消编辑优化师"/)
  assert.match(pageSource, /savingTokenId === token\.id/)
})
```

- [ ] **Step 2: Run the test to verify RED**

Run: `cd autoark-frontend && npm test`

Expected: the new test fails because `handleSaveOptimizer`, the inline input, and save/cancel controls do not exist on `FacebookSettingsPage`.

### Task 2: Implement row-level editing

**Files:**
- Modify: `autoark-frontend/src/pages/FacebookSettingsPage.tsx`
- Test: `autoark-frontend/tests/facebook-settings-optimizer.test.mjs`

- [ ] **Step 1: Import the existing update API and add edit state**

Add `updateToken` to the service import and add these states beside the Token state:

```tsx
const [editingTokenId, setEditingTokenId] = useState<string | null>(null)
const [editOptimizer, setEditOptimizer] = useState('')
const [savingTokenId, setSavingTokenId] = useState<string | null>(null)
```

- [ ] **Step 2: Add start, cancel, and save handlers**

```tsx
const handleStartOptimizerEdit = (token: FbToken) => {
  setEditingTokenId(token.id)
  setEditOptimizer(token.optimizer || '')
  setMessage(null)
}

const handleCancelOptimizerEdit = () => {
  if (savingTokenId) return
  setEditingTokenId(null)
  setEditOptimizer('')
}

const handleSaveOptimizer = async (token: FbToken) => {
  if (savingTokenId) return
  setSavingTokenId(token.id)
  setMessage(null)
  try {
    await updateToken(token.id, { optimizer: editOptimizer.trim() })
    await refetchTokens()
    setEditingTokenId(null)
    setEditOptimizer('')
    setMessage({ type: 'success', text: '优化师已更新' })
  } catch (error: any) {
    setMessage({ type: 'error', text: error.message || '优化师更新失败' })
  } finally {
    setSavingTokenId(null)
  }
}
```

- [ ] **Step 3: Replace the optimizer cell with view/edit states**

```tsx
<td className="px-6 py-4 font-medium">
  {editingTokenId === token.id ? (
    <input
      type="text"
      value={editOptimizer}
      onChange={(e) => setEditOptimizer(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') handleSaveOptimizer(token)
        if (e.key === 'Escape') handleCancelOptimizerEdit()
      }}
      maxLength={80}
      disabled={savingTokenId === token.id}
      aria-label={`编辑 ${token.fbUserName || token.fbUserId || 'Token'} 的优化师`}
      className="w-36 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
      autoFocus
    />
  ) : (
    token.optimizer || '-'
  )}
</td>
```

- [ ] **Step 4: Render edit or save/cancel actions for the row**

Replace the current action buttons with this conditional block:

```tsx
{editingTokenId === token.id ? (
  <>
    <button
      onClick={() => handleSaveOptimizer(token)}
      disabled={savingTokenId === token.id}
      aria-label="保存优化师"
      className="px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50"
    >
      {savingTokenId === token.id ? '保存中...' : '保存'}
    </button>
    <button
      onClick={handleCancelOptimizerEdit}
      disabled={savingTokenId === token.id}
      aria-label="取消编辑优化师"
      className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
    >
      取消
    </button>
  </>
) : (
  <>
    <button
      onClick={() => handleStartOptimizerEdit(token)}
      className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
    >
      编辑
    </button>
    <button
      onClick={() => handleCheckToken(token)}
      disabled={checkingToken === token.id}
      className="px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
    >
      {checkingToken === token.id ? '检查中...' : '检查'}
    </button>
    <button
      onClick={() => handleDeleteToken(token)}
      className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
    >
      删除
    </button>
  </>
)}
```

- [ ] **Step 5: Run the focused frontend tests to verify GREEN**

Run: `cd autoark-frontend && npm test`

Expected: all dashboard and optimizer-edit regression tests pass.

- [ ] **Step 6: Run frontend type checking and production build**

Run: `cd autoark-frontend && npm run build`

Expected: TypeScript and Vite exit successfully.

- [ ] **Step 7: Commit the implementation**

```bash
git add autoark-frontend/src/pages/FacebookSettingsPage.tsx autoark-frontend/tests/facebook-settings-optimizer.test.mjs
git commit -m "feat: edit token optimizer assignments"
```

### Task 3: Review, release, and production verification

**Files:**
- Verify: `autoark-frontend/src/pages/FacebookSettingsPage.tsx`
- Verify: `autoark-frontend/tests/facebook-settings-optimizer.test.mjs`

- [ ] **Step 1: Run repository verification**

Run:

```bash
cd autoark-frontend && npm test && npm run build
cd ../autoark-backend && npm test -- --runInBand && npm run build
cd .. && git diff --check
```

Expected: zero failures, successful builds, and no whitespace errors.

- [ ] **Step 2: Review the final diff**

Run:

```bash
git diff -- autoark-frontend/src/pages/FacebookSettingsPage.tsx autoark-frontend/tests/facebook-settings-optimizer.test.mjs
```

Confirm the change only updates the current settings page and its test, sends no Token value, preserves edit state on failure, and sends `optimizer: ''` when clearing.

- [ ] **Step 3: Push and pass CI**

Run `git push origin HEAD:main`, then watch the new `AutoArk CI` run for the pushed commit until it completes successfully.

- [ ] **Step 4: Deploy through the guarded production workflow**

Run:

```bash
gh workflow run "AutoArk Production Deploy" -f ref=main
deploy_run_id="$(gh run list --workflow "AutoArk Production Deploy" --branch main --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$deploy_run_id" --exit-status
```

Expected: the production deploy and its health verification complete successfully.

- [ ] **Step 5: Verify the live UI without leaving test data**

Open `https://app.autoark.work/fb-settings`, edit one visible Token to a temporary optimizer marker, save, refresh, and confirm persistence. Restore the exact original value (including blank), refresh again, and confirm restoration. Verify Enter, Escape, save disabling, success/error feedback, and absence of console errors.

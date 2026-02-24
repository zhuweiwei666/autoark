/**
 * 一次性迁移脚本：将 AgentLongMemory 中的数据迁移到 Knowledge 表
 *
 * 用法：npx ts-node scripts/migrate-memory-to-knowledge.ts
 *
 * 迁移映射：
 *   LongTermMemory.category='lesson'   → Knowledge.category='decision_lesson'
 *   LongTermMemory.category='pattern'  → Knowledge.category='campaign_pattern'
 *   LongTermMemory.category='feedback' → Knowledge.category='user_preference'
 */
import mongoose from 'mongoose'
import dotenv from 'dotenv'

dotenv.config()

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/autoark'

const CATEGORY_MAP: Record<string, string> = {
  lesson: 'decision_lesson',
  pattern: 'campaign_pattern',
  feedback: 'user_preference',
}

const SOURCE_MAP: Record<string, string> = {
  reflection: 'reflection',
  user_feedback: 'user_feedback',
  statistical: 'statistical',
  evolution: 'evolution',
}

async function migrate() {
  await mongoose.connect(MONGO_URI)
  console.log(`Connected to ${MONGO_URI}`)

  const longTermCollection = mongoose.connection.collection('agentlongmemories')
  const knowledgeCollection = mongoose.connection.collection('knowledges')

  const docs = await longTermCollection.find({}).toArray()
  console.log(`Found ${docs.length} documents in AgentLongMemory`)

  let migrated = 0
  let skipped = 0

  for (const doc of docs) {
    const newCategory = CATEGORY_MAP[doc.category] || 'decision_lesson'
    const newSource = SOURCE_MAP[doc.source] || 'reflection'

    const existing = await knowledgeCollection.findOne({ key: doc.key })
    if (existing) {
      skipped++
      continue
    }

    await knowledgeCollection.insertOne({
      category: newCategory,
      key: doc.key,
      content: doc.content,
      data: doc.data,
      confidence: doc.confidence ?? 0.5,
      validations: doc.validations ?? 1,
      source: newSource,
      relatedSkills: [],
      relatedPackages: doc.relatedPackages || [],
      tags: doc.tags || [],
      archived: false,
      lastValidatedAt: doc.updatedAt || new Date(),
      createdAt: doc.createdAt || new Date(),
      updatedAt: doc.updatedAt || new Date(),
    })
    migrated++
  }

  console.log(`Migration complete: ${migrated} migrated, ${skipped} skipped (already exist)`)
  await mongoose.disconnect()
}

migrate().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})

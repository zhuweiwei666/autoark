import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

const backendRequire = createRequire(
  new URL('../autoark-backend/package.json', import.meta.url),
)
const sharp = backendRequire('sharp')
const runner = new URL('./creative-factory-media.mjs', import.meta.url).pathname

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
  })
  assert.equal(
    result.status,
    0,
    `${command} failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  )
  return result.stdout
}

const writeRecipe = async (directory, recipe) => {
  const recipePath = path.join(directory, 'recipe.json')
  await fs.writeFile(recipePath, JSON.stringify(recipe))
  return recipePath
}

const makeVideo = (directory) => {
  const input = path.join(directory, 'source.mp4')
  run(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x1f7a8c:s=320x568:d=1:r=12',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      input,
    ],
    directory,
  )
  return input
}

test('applies reference-derived styling to an image source', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'creative-media-image-'),
  )
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const input = path.join(directory, 'source.jpg')
  const output = path.join(directory, 'output.jpg')
  await sharp({
    create: { width: 320, height: 568, channels: 3, background: '#667085' },
  })
    .jpeg()
    .toFile(input)
  const recipePath = await writeRecipe(directory, {
    input,
    output,
    mediaType: 'image',
    style: { contrast: 1.1, saturation: 0.8 },
    textOverlays: [
      {
        text: 'Create with ClingAI',
        x: 0.08,
        y: 0.1,
        width: 0.84,
        height: 0.16,
        unit: 'ratio',
      },
    ],
    brand: { label: 'ClingAI', background: '#0b1220', color: '#22d3ee' },
  })

  const result = JSON.parse(
    run(process.execPath, [runner, recipePath], directory),
  )
  const metadata = await sharp(output).metadata()
  assert.equal(result.mediaType, 'image')
  assert.equal(metadata.width, 320)
  assert.equal(metadata.height, 568)
})

test('extracts a source video frame before producing an image', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'creative-media-frame-'),
  )
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const input = makeVideo(directory)
  const output = path.join(directory, 'output.png')
  const recipePath = await writeRecipe(directory, {
    input,
    output,
    mediaType: 'image',
    sourceMediaType: 'video',
    extractFrame: { position: 0.5 },
    style: { contrast: 1.15, saturation: 0.9 },
    brand: { label: 'ClingAI', background: '#0b1220', color: '#22d3ee' },
  })

  const result = JSON.parse(
    run(process.execPath, [runner, recipePath], directory),
  )
  const metadata = await sharp(output).metadata()
  assert.equal(result.mediaType, 'image')
  assert.equal(metadata.width, 320)
  assert.equal(metadata.height, 568)
})

test('applies styling and timed text while editing a video', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'creative-media-video-'),
  )
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const input = makeVideo(directory)
  const output = path.join(directory, 'output.mp4')
  const recipePath = await writeRecipe(directory, {
    input,
    output,
    mediaType: 'video',
    style: { brightness: 1.03, contrast: 1.12, saturation: 0.85 },
    textOverlays: [
      {
        text: 'Create with ClingAI',
        x: 0.08,
        y: 0.1,
        width: 0.84,
        height: 0.16,
        unit: 'ratio',
        start: 0,
        end: 0.8,
      },
    ],
    brand: { label: 'ClingAI', background: '#0b1220', color: '#22d3ee' },
  })

  const result = JSON.parse(
    run(process.execPath, [runner, recipePath], directory),
  )
  assert.equal(result.mediaType, 'video')
  assert.equal(result.width, 320)
  assert.equal(result.height, 568)
  assert.ok(result.duration > 0)
  await fs.access(output)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { qualityOrder } from '../src/quality.js'

test('standard playback never silently opts in to higher qualities', () => {
  assert.deepEqual(qualityOrder(['128k']), ['128k'])
  assert.deepEqual(qualityOrder(['flac', '320k', '128k']), ['flac', '320k', '128k'])
  assert.deepEqual(qualityOrder(['320k', 'oops', '320k']), ['320k'])
})

test('missing preferences default to high quality with standard fallback', () => {
  assert.deepEqual(qualityOrder(undefined), ['320k', '128k'])
  assert.deepEqual(qualityOrder([], true), [])
})

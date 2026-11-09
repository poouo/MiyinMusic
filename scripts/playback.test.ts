import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextPlaybackMode, nextTrackIndex, playbackMode, playbackSettings } from '../web/src/lib/playback.ts'

test('mode control completes one four-state cycle without combining shuffle and single repeat', () => {
  let mode = nextPlaybackMode('off')
  assert.equal(mode, 'all')
  mode = nextPlaybackMode(mode)
  assert.equal(mode, 'one')
  mode = nextPlaybackMode(mode)
  assert.equal(mode, 'shuffle')
  assert.equal(nextPlaybackMode(mode), 'off')
  assert.equal(playbackMode('one', true), 'shuffle')
})

test('natural completion stops only at the end of sequential mode', () => {
  assert.equal(nextTrackIndex(2, 3, 'off', false), -1)
  assert.equal(nextTrackIndex(1, 3, 'off', false), 2)
  assert.equal(nextTrackIndex(2, 3, 'all', false), 0)
  assert.equal(nextTrackIndex(1, 3, 'one', false), 1)
  assert.equal(nextTrackIndex(0, 0, 'all', false), -1)
})

test('manual next advances in single repeat and wraps at queue boundaries', () => {
  assert.equal(nextTrackIndex(1, 3, 'one', true), 2)
  for (const mode of ['off', 'one', 'all'] as const) {
    assert.equal(nextTrackIndex(2, 3, mode, true), 0)
  }
})

test('shuffle never selects the current track, including the first and last random slots', () => {
  for (let count = 2; count <= 40; count++) {
    for (let index = 0; index < count; index++) {
      for (const random of [0, .1, .5, .999999]) {
        const next = nextTrackIndex(index, count, 'shuffle', false, () => random)
        assert.notEqual(next, index)
        assert.ok(next >= 0 && next < count)
      }
    }
  }
  assert.equal(nextTrackIndex(0, 1, 'shuffle', false), 0)
})

test('direct menu selection replaces either prior playback flag with a canonical state', () => {
  for (const mode of ['shuffle', 'off', 'one', 'all'] as const) {
    const state = playbackSettings(mode)
    assert.equal(playbackMode(state.repeat, state.shuffle), mode)
    assert.equal(state.shuffle && state.repeat === 'one', false)
  }
})

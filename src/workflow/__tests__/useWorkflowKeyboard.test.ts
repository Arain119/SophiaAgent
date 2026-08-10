import { expect, test } from 'bun:test'
import { routeWorkflowKey } from '../panel/useWorkflowKeyboard.js'

test('Tab routes forward and Shift+Tab routes backward', () => {
  expect(routeWorkflowKey('', { tab: true })).toBe('nextTab')
  expect(routeWorkflowKey('', { tab: true, shift: true })).toBe('prevTab')
})

test('q and Esc quit', () => {
  expect(routeWorkflowKey('q', {})).toBe('quit')
  expect(routeWorkflowKey('', { escape: true })).toBe('quit')
})

test('x kills an agent, K kills the workflow, and r resumes', () => {
  expect(routeWorkflowKey('x', {})).toBe('killAgent')
  expect(routeWorkflowKey('K', {})).toBe('killWorkflow')
  expect(routeWorkflowKey('r', {})).toBe('resume')
  expect(routeWorkflowKey('n', {})).toBeNull()
})

test('confirm mode accepts confirmation keys and swallows other input', () => {
  expect(routeWorkflowKey('y', {}, 'confirm')).toBe('confirmYes')
  expect(routeWorkflowKey('Y', {}, 'confirm')).toBe('confirmYes')
  expect(routeWorkflowKey('', { return: true }, 'confirm')).toBe('confirmYes')
  expect(routeWorkflowKey('n', {}, 'confirm')).toBe('confirmNo')
  expect(routeWorkflowKey('N', {}, 'confirm')).toBe('confirmNo')
  expect(routeWorkflowKey('', { escape: true }, 'confirm')).toBe('confirmNo')
  expect(routeWorkflowKey('q', {}, 'confirm')).toBe('confirmNo')
  expect(routeWorkflowKey('x', {}, 'confirm')).toBeNull()
  expect(routeWorkflowKey('', { tab: true }, 'confirm')).toBeNull()
  expect(routeWorkflowKey('', { upArrow: true }, 'confirm')).toBeNull()
})

test('arrow keys navigate columns and rows', () => {
  expect(routeWorkflowKey('', { leftArrow: true })).toBe('focusLeft')
  expect(routeWorkflowKey('', { rightArrow: true })).toBe('focusRight')
  expect(routeWorkflowKey('', { upArrow: true })).toBe('moveUp')
  expect(routeWorkflowKey('', { downArrow: true })).toBe('moveDown')
})

test('unrelated input is ignored', () => {
  expect(routeWorkflowKey('z', {})).toBeNull()
  expect(routeWorkflowKey('', {})).toBeNull()
})

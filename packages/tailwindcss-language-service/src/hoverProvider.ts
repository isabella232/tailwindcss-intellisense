import { State } from './util/state'
import type { Hover, TextDocument, Position } from 'vscode-languageserver'
import { stringifyCss, stringifyConfigValue } from './util/stringify'
import dlv from 'dlv'
import { isCssContext } from './util/css'
import { findClassNameAtPosition } from './util/find'
import { validateApply } from './util/validateApply'
import { getClassNameParts } from './util/getClassNameAtPosition'
import * as jit from './util/jit'
import { validateConfigPath } from './diagnostics/getInvalidConfigPathDiagnostics'
import { getTextWithoutComments } from './util/doc'

export async function doHover(
  state: State,
  document: TextDocument,
  position: Position
): Promise<Hover> {
  return (
    (await provideClassNameHover(state, document, position)) ||
    provideCssHelperHover(state, document, position)
  )
}

function provideCssHelperHover(state: State, document: TextDocument, position: Position): Hover {
  if (!isCssContext(state, document, position)) return null

  const line = getTextWithoutComments(document, 'css').split('\n')[position.line]

  const match = line.match(/(?<helper>theme|config)\((?<quote>['"])(?<key>[^)]+)\k<quote>[^)]*\)/)

  if (match === null) return null

  const startChar = match.index + match.groups.helper.length + 2
  const endChar = startChar + match.groups.key.length

  if (position.character < startChar || position.character >= endChar) {
    return null
  }

  let key = match.groups.key
    .split(/(\[[^\]]+\]|\.)/)
    .filter(Boolean)
    .filter((x) => x !== '.')
    .map((x) => x.replace(/^\[([^\]]+)\]$/, '$1'))

  if (key.length === 0) return null

  if (match.groups.helper === 'theme') {
    key = ['theme', ...key]
  }

  const value = validateConfigPath(state, key).isValid
    ? stringifyConfigValue(dlv(state.config, key))
    : null

  if (value === null) return null

  return {
    contents: { kind: 'markdown', value: ['```plaintext', value, '```'].join('\n') },
    range: {
      start: { line: position.line, character: startChar },
      end: {
        line: position.line,
        character: endChar,
      },
    },
  }
}

async function provideClassNameHover(
  state: State,
  document: TextDocument,
  position: Position
): Promise<Hover> {
  let className = await findClassNameAtPosition(state, document, position)
  if (className === null) return null

  if (state.jit) {
    let { root, rules } = jit.generateRules(state, [className.className])

    if (rules.length === 0) {
      return null
    }

    return {
      contents: {
        language: 'css',
        value: await jit.stringifyRoot(state, root, document.uri),
      },
      range: className.range,
    }
  }

  const parts = getClassNameParts(state, className.className)
  if (!parts) return null

  if (isCssContext(state, document, position)) {
    let validated = validateApply(state, parts)
    if (validated === null || validated.isApplyable === false) {
      return null
    }
  }

  const settings = await state.editor.getConfiguration(document.uri)

  const css = stringifyCss(
    className.className,
    dlv(state.classNames.classNames, [...parts, '__info']),
    settings
  )

  if (!css) return null

  return {
    contents: {
      language: 'css',
      value: css,
    },
    range: className.range,
  }
}

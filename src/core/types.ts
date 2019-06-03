import { getKeyname } from './utils'
import { Common } from '.'

export interface ParsedFile {
  filepath: string
  locale: string
  value: object
  nested: boolean
  flatten: Record<string, string>
}

export interface LocaleRecord {
  keypath: string
  keyname: string
  value: string
  locale: string
  filepath?: string
  shadow?: boolean
  type: 'record'
}

export class LocaleNode {
  keyname: string
  type: 'node' = 'node'

  constructor (
    public readonly keypath: string,
    public readonly locales: Record<string, LocaleRecord> = {},
    public readonly shadow = false
  ) {
    this.keyname = getKeyname(keypath)
  }

  getValue (locale: string, fallback = '') {
    return (this.locales[locale] && this.locales[locale].value) || fallback
  }

  get value () {
    return this.getValue(Common.displayLanguage)
  }
}

export interface FlattenLocaleTree extends Record<string, LocaleNode> {}

export interface LocaleTree {
  keypath: string
  keyname: string
  children: Record<string, LocaleTree|LocaleNode>
  type: 'tree'
}

export interface Coverage {
  locale: string
  keys: string[]
  translated: number
  total: number
}

export interface PendingWrite {
  locale: string
  keypath: string
  filepath?: string
  value: string
}

export type LocaleLoaderEventType =
  | 'changed'

import { MarkdownString } from 'vscode'
import { Commands } from '~/commands'
import i18n from '~/i18n'
import { CurrentFile, Global, LocaleRecord, Config, ActionSource } from '~/core'
import { decorateLocale, escapeMarkdown, NodeHelper } from '~/utils'
import { LocaleTree } from '~/core'

const EmptyButton = '⠀⠀'

function makeMarkdownCommand(command: Commands, args: any): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify({ actionSource: ActionSource.Hover, ...args }))}`
}

function formatValue(text: string) {
  return escapeMarkdown(text.replace(/[\s]+/g, ' '))
}

function getAvaliableCommands(record?: LocaleRecord, keyIndex?: number) {
  const commands = []

  if (record) {
    const { keypath, locale } = record

    if (Config.reviewEnabled) {
      commands.push({
        text: i18n.t('command.open_review'),
        icon: '💬', // '$(comment-discussion)' // AWAIT_VSCODE_FIX
        command: makeMarkdownCommand(Commands.open_in_editor, { keypath, locale, keyIndex }),
      })
    }

    if (NodeHelper.isTranslatable(record)) {
      commands.push({
        text: i18n.t('command.translate_key'),
        icon: '🌏', // '$(globe)' // AWAIT_VSCODE_FIX
        command: makeMarkdownCommand(Commands.translate_key, { keypath, locale }),
      })
    }

    if (NodeHelper.isEditable(record)) {
      commands.push({
        text: i18n.t('command.edit_key'),
        icon: '✏️', // '$(edit)' // AWAIT_VSCODE_FIX
        command: Config.preferEditor
          ? makeMarkdownCommand(Commands.open_in_editor, { keypath, locale, keyIndex })
          : makeMarkdownCommand(Commands.edit_key, { keypath, locale }),
      })
    }
    else {
      commands.push(EmptyButton)
    }

    if (NodeHelper.isOpenable(record)) {
      commands.push({
        text: i18n.t('command.open_key'),
        icon: '↗️', // '$(link-external)' // AWAIT_VSCODE_FIX
        command: makeMarkdownCommand(Commands.open_key, { keypath, locale }),
      })
    }
    else {
      commands.push(EmptyButton)
    }
  }

  return commands
}

export function createTable(visibleLocales: string[], records: Record<string, LocaleRecord>, maxLength = 0, keyIndex?: number) {
  const transTable = visibleLocales
    .flatMap((locale) => {
      const record = records[locale]
      if (!record)
        return []

      const row = {
        locale: decorateLocale(locale),
        value: formatValue(CurrentFile.loader.getValueByKey(record.keypath, locale, maxLength) || '-'),
        commands: '',
      }

      if (record instanceof LocaleRecord) {
        const commands = getAvaliableCommands(record, keyIndex)
        row.commands = commands
          .map(c => typeof c === 'string' ? c : `[${c.icon}](${c.command} "${c.text}")`)
          .join(' ')
      }

      return [row]
    })
    .map(item => `| | **${item.locale}** | | ${item.value} | ${item.commands} |`)
    .join('\n')

  if (!transTable)
    return ''

  return `| | | | | |\n|---|---:|---|---|---:|\n${transTable}\n| | | | | |`
}

export function createHover(keypath: string, maxLength = 0, mainLocale?: string, keyIndex?: number) {
  const loader = CurrentFile.loader
  let records: Record<string, LocaleRecord> = loader.getTranslationsByKey(keypath, undefined)

  if (!Object.keys(records).length) {
    const tree = loader.getTreeNodeByKey(keypath, undefined)

    if (! tree || tree.type !== 'tree')
      return

    records = createHoverRecordsForTreeNode(tree)
  }

  mainLocale = mainLocale || Config.displayLanguage

  const locales = Global.visibleLocales.filter(i => i !== mainLocale)
  const table1 = createTable([mainLocale, ...locales], records, maxLength, keyIndex)
  const markdown = `${table1}`

  const markdownText = new MarkdownString(`${markdown}`, true)
  markdownText.isTrusted = true

  return markdownText
}

/**
 * There should be a table
 *
 * | A | B |
 * |---|---|
 * | Hello | World |
 *
 * But nothing is rendered
 */
function a() {

}

a()

function createHoverRecordsForTreeNode(tree: LocaleTree): Record<string, LocaleRecord> {
  if (!tree) return {}

 const realRecords: Record<string, LocaleRecord> = {}

  for (const locale in tree.values) {
    realRecords[locale] = new LocaleRecord({
      keypath: tree.keypath,
      locale,
      value: '',
    })
  }

  return realRecords
}

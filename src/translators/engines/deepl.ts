import axios from 'axios'
import qs from 'qs'
import TranslateEngine, { TranslateOptions, TranslateResult } from './base'
import { Log } from '~/utils'
import { Config } from '~/core'

interface DeepLUsage {
  character_count: number
  character_limit: number
}

interface DeepLTranslate {
  detected_source_language: string
  text: string
}

interface DeepLTranslateRes {
  translations: DeepLTranslate[]
}

type GlossaryIdentifyingPartial = {
  glossary_id: string
}

type DeeplGlossaryInfo = {
  glossary_id: string,
  name: string
  ready: boolean,
  source_lang: string,
  target_lang: string,
  creation_time: string, // iso string
  entry_count: number
}

type GlossaryInfoCache = {
  lastUpdate?: number,
  glossaries?: Array<DeeplGlossaryInfo>
}

const deepl = axios.create({})

deepl.interceptors.request.use((req) => {
  req.baseURL = Config.deeplUseFreeApiEntry
    ? 'https://api-free.deepl.com/v2'
    : 'https://api.deepl.com/v2'

  req.headers['Authorization'] = `DeepL-Auth-Key ${Config.deeplApiKey}`

  if (!req.headers['Content-Type'] && (req.method === 'POST' || req.method === 'post')) {
    req.headers['Content-Type'] = 'application/x-www-form-urlencoded'
    req.data = qs.stringify(req.data)
  }

  log(true, req)

  return req
})

deepl.interceptors.response.use((res) => {
  log(true, res)

  return res
})

function log(inspector: boolean, ...args: any[]): void {
  if (Config.deeplLog) {
    // eslint-disable-next-line no-console
    if (inspector) console.log('[DeepL]\n', ...args)
    else Log.raw(...args)
  }
}

async function usage(): Promise<DeepLUsage> {
  try {
    return await deepl.get('/usage').then(({ data }) => data)
  }
  catch (err) {
    log(false, err)

    throw err
  }
}

function stripeLocaleCode(locale?: string): string | undefined {
  if (!locale)
    return locale
  const index = locale.indexOf('-')
  if (index === -1)
    return locale
  return locale.slice(0, index)
}

class DeepL extends TranslateEngine {
  async translate(options: TranslateOptions) {

    try {
      const res: DeepLTranslateRes = await deepl({
        method: 'POST',
        url: '/translate',
        data: {
          text: options.text,
          source_lang: stripeLocaleCode(options.from || undefined),
          target_lang: stripeLocaleCode(options.to),
          ...await DeeplGlossaries.getTranslationRequestGlossaryIdentifier(options)
        },
      }).then(({ data }) => data)

      return this.transform(res.translations, options)
    }
    catch (err) {
      log(false, err)

      throw err
    }
  }

  transform(res: DeepLTranslate[], options: TranslateOptions): TranslateResult {
    const r: TranslateResult = {
      text: options.text,
      to: options.to || 'auto',
      from: options.from || 'auto',
      response: res,
      linkToResult: '',
    }

    try {
      const result: string[] = []

      res.forEach((tran: DeepLTranslate) => result.push(tran.text))

      r.result = result
    }
    catch (err) {}

    if (!r.detailed && !r.result) r.error = new Error('No result')

    log(false, `DEEPL TRANSLATE!! ${JSON.stringify(r.result)}, from ${options.from} to ${options.to}`)

    return r
  }
}

const GLOSSARY_CACHE_TTL = 60 * 1000 // 1 minute

class DeeplGlossaries {

  static readonly cache: GlossaryInfoCache = {}

  public isEnabled(): boolean {
    const dir = Config.deeplGlossariesDir

    return !! dir
  }

  public async updateGlossary(targetLanguage: string, sourceLanguage: string, content: string) {
    try {
      const glossaries = await this.getGlossaryIds(targetLanguage, sourceLanguage)

      glossaries.forEach(async id => {
        await this.deleteGlossary(id)
      })

      await this.createGlossary(targetLanguage, sourceLanguage, content)
    } finally {
      this.invalidateCache()
    }
  }

  public async getGlossaryId(targetLanguage: string, sourceLanguage: string): Promise<string|undefined> {
    const glossaries = await this.getGlossaryIds(targetLanguage, sourceLanguage)

    if (glossaries.length >= 1) {
      return glossaries[0]
    }
  }

  public async readGlossaryList(): Promise<Array<DeeplGlossaryInfo>> {
    if (this.isCached()) {
      return DeeplGlossaries.cache.glossaries!
    }

    try {
      const { glossaries } = await deepl({
        url: '/glossaries',
      }).then(({ data }) => data)

      if (glossaries) {
        DeeplGlossaries.cache.lastUpdate = Date.now()
        DeeplGlossaries.cache.glossaries = glossaries as Array<DeeplGlossaryInfo>

        return glossaries
      } else {
        throw new Error('Can not read glossaries')
      }
    } catch (err) {
      log(false, err)

      throw err
    }
  }

  private async getGlossaryIds(targetLanguage: string, sourceLanguage: string): Promise<Array<string>> {
    const glossaries = await this.readGlossaryList()

    return glossaries.filter(({ source_lang, target_lang }) => {
          return source_lang === sourceLanguage && target_lang === targetLanguage
        })
        .map(glossary => glossary.glossary_id)
  }

  private async deleteGlossary(id: string) {
    try {
      const { status, data } = await deepl({
        url: `/glossaries/${id}`,
        method: 'DELETE'
      })

      if (status === 204) {
        log(false, `Successfully deleted glossary ${id}`)
      } else {
        const { message, detail } = await data

        throw new Error(`Couldn't delete glossary ${id}: ${status}\n${message}\n${detail}`)
      }
    } catch (e) {
      log(false, `Couldn't delete glossary ${id}`, e)
      throw e
    }
  }

  private async createGlossary(targetLanguage: string, sourceLanguage: string, content: string) {
    if (! content || content.length === 0) {
      throw new Error(`Didn't create glossary ${sourceLanguage} => ${targetLanguage}: with empty content.`)
    }

    try {
      const { status, data } = await deepl({
        url: `/glossaries`,
        method : 'POST',
        headers : {
          'Content-Type' : 'application/json'
        },
        data : JSON.stringify({
          name : `${sourceLanguage}-${targetLanguage}`,
          source_lang : sourceLanguage,
          target_lang : targetLanguage,
          entries_format : 'csv',
          entries : content
        })
      })

      if (status !== 201) {
        // we have some kind of error
        const { message, detail } = data

        throw new Error(`Couldn't create glossary ${sourceLanguage} => ${targetLanguage}: ${status}\n${message}\n${detail}`)
      }
    } catch (e) {
      log(false, `Couldn't create glossary ${sourceLanguage} => ${targetLanguage}`, e)
      throw e
    }
  }

  private isCached(): boolean {
    return !! (DeeplGlossaries.cache.lastUpdate && Date.now() - DeeplGlossaries.cache.lastUpdate < GLOSSARY_CACHE_TTL)
  }

  private invalidateCache() {
    DeeplGlossaries.cache.lastUpdate = 0
    DeeplGlossaries.cache.glossaries = []
  }

  public static async getTranslationRequestGlossaryIdentifier(options: TranslateOptions): Promise<GlossaryIdentifyingPartial|{}> {
    try {
      const glossaries = new DeeplGlossaries()

      if (glossaries.isEnabled() && options.from && options.to) {
        const glossaryId = await glossaries.getGlossaryId(options.to, options.from)

        if (glossaryId) {
          return {
            glossary_id: glossaryId
          };
        }
      }
    } catch (error) {
      log(false, `Error reading glossary id for translation from ${options.from} => ${options.to}`, error)
    }

    return {};
  }
}

export default DeepL

export {
  usage,
  DeeplGlossaries
}

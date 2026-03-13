import { createStore } from "solid-js/store"
import { batch, createEffect, createMemo, onCleanup } from "solid-js"
import { useParams } from "@solidjs/router"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { base64Encode } from "@opencode-ai/util/encode"
import { useProviders } from "@/hooks/use-providers"
import { useModels } from "@/context/models"
import { modelEnabled, modelProbe } from "@/testing/model-selection"
import { Persist, persisted } from "@/utils/persist"
import { cycleModelVariant, getConfiguredAgentVariant, resolveModelVariant } from "./model-variant"

export type ModelKey = { providerID: string; modelID: string }

type State = {
  agent?: string
  model?: ModelKey | null
  variant?: string | null
}

const WORKSPACE_KEY = "__workspace__"

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const params = useParams()
    const sdk = useSDK()
    const sync = useSync()
    const providers = useProviders()
    const models = useModels()
    const connected = createMemo(() => new Set(providers.connected().map((provider) => provider.id)))
    const sid = createMemo(() => params.id)
    const key = createMemo(() => params.id ?? WORKSPACE_KEY)
    const list = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent" && !x.hidden))

    const [saved, setSaved] = persisted(
      Persist.workspace(sdk.directory, "model-selection", ["model-selection.v1"]),
      createStore<{
        pick: Record<string, State | undefined>
      }>({
        pick: {},
      }),
    )
    const [handoff, setHandoff] = persisted(
      Persist.global("model-selection-handoff", ["model-selection-handoff.v1"]),
      createStore<{
        pick: Record<string, State | undefined>
      }>({
        pick: {},
      }),
    )

    const [store, setStore] = createStore<{
      current?: string
      base: Record<string, State | undefined>
    }>({
      current: list()[0]?.name,
      base: {},
    })

    function isModelValid(model: ModelKey) {
      const provider = providers.all().find((x) => x.id === model.providerID)
      return !!provider?.models[model.modelID] && connected().has(model.providerID)
    }

    function getFirstValidModel(...modelFns: (() => ModelKey | undefined)[]) {
      for (const modelFn of modelFns) {
        const model = modelFn()
        if (!model) continue
        if (isModelValid(model)) return model
      }
    }

    const handoffKey = (dir: string, id: string) => `${dir}\n${id}`

    const read = (type: "pick" | "base", id: string | undefined) => {
      if (!id) return undefined
      if (type === "base") return store.base[id]
      if (saved.pick[id] !== undefined) return saved.pick[id]
      if (id === WORKSPACE_KEY) return undefined
      return handoff.pick[handoffKey(sdk.directory, id)]
    }

    const write = (type: "pick" | "base", id: string, next: Partial<State>) => {
      if (type === "pick") {
        setSaved("pick", id, (prev) => ({ ...(prev ?? {}), ...next }))
        return
      }
      setStore(type, id, (prev) => ({ ...(prev ?? {}), ...next }))
    }

    const pick = createMemo(() => read("pick", key()))
    const base = createMemo(() => read("base", sid()))

    createEffect(() => {
      const id = sid()
      if (!id) return
      const next = handoff.pick[handoffKey(sdk.directory, id)]
      if (!next) return
      batch(() => {
        setSaved("pick", id, next)
        setHandoff("pick", handoffKey(sdk.directory, id), undefined)
      })
    })

    const match = (name: string | undefined) => {
      const available = list()
      if (available.length === 0) return undefined
      return available.find((x) => x.name === name) ?? available[0]
    }

    const resolveConfigured = () => {
      if (!sync.data.config.model) return
      const [providerID, modelID] = sync.data.config.model.split("/")
      const key = { providerID, modelID }
      if (isModelValid(key)) return key
    }

    const resolveRecent = () => {
      for (const item of models.recent.list()) {
        if (isModelValid(item)) return item
      }
    }

    const resolveDefault = () => {
      const defaults = providers.default()
      for (const provider of providers.connected()) {
        const configured = defaults[provider.id]
        if (configured) {
          const key = { providerID: provider.id, modelID: configured }
          if (isModelValid(key)) return key
        }

        const first = Object.values(provider.models)[0]
        if (!first) continue
        const key = { providerID: provider.id, modelID: first.id }
        if (isModelValid(key)) return key
      }
    }

    const fallback = createMemo<ModelKey | undefined>(() => {
      return resolveConfigured() ?? resolveRecent() ?? resolveDefault()
    })

    const choose = (selected: ModelKey | null | undefined, restored: ModelKey | null | undefined) => {
      if (selected === null || (selected === undefined && restored === null)) {
        return getFirstValidModel(() => agent.current()?.model, fallback)
      }

      return getFirstValidModel(
        () => selected ?? undefined,
        () => restored ?? undefined,
        () => agent.current()?.model,
        fallback,
      )
    }

    const writeModel = (model: ModelKey | undefined, options?: { recent?: boolean; restore?: boolean }) => {
      const id = options?.restore && sid() ? sid() : key()
      if (!id) return

      batch(() => {
        write(options?.restore && sid() ? "base" : "pick", id, { model: model ?? null })
        if (options?.restore) return
        if (model) models.setVisibility(model, true)
        if (options?.recent && model) models.recent.push(model)
      })
    }

    const writeVariant = (value: string | undefined, options?: { restore?: boolean }) => {
      const id = options?.restore && sid() ? sid() : key()
      if (!id) return
      write(options?.restore && sid() ? "base" : "pick", id, { variant: value ?? null })
    }

    const setAgent = (name: string | undefined, options?: { restore?: boolean }) => {
      const value = match(name)
      if (!value) {
        if (!options?.restore) setStore("current", undefined)
        return
      }

      batch(() => {
        if (options?.restore && sid()) {
          write("base", sid()!, { agent: value.name })
          return
        }

        setStore("current", value.name)

        if (sid()) {
          write("pick", sid()!, {
            agent: value.name,
            model: value.model ?? null,
            variant: value.variant ?? null,
          })
          return
        }

        write("pick", WORKSPACE_KEY, {
          agent: value.name,
          model: value.model ?? null,
          variant: value.variant ?? null,
        })
      })
    }

    const agent = {
      list,
      current() {
        return match(pick()?.agent ?? base()?.agent ?? store.current)
      },
      set: setAgent,
      move(direction: 1 | -1) {
        const available = list()
        if (available.length === 0) {
          setStore("current", undefined)
          return
        }
        let next = available.findIndex((x) => x.name === agent.current()?.name) + direction
        if (next < 0) next = available.length - 1
        if (next >= available.length) next = 0
        const value = available[next]
        if (!value) return
        setAgent(value.name)
      },
    }

    const current = createMemo(() => {
      const key = choose(pick()?.model, base()?.model)
      if (!key) return undefined
      return models.find(key)
    })

    const recent = createMemo(() => models.recent.list().map(models.find).filter(Boolean))

    const model = {
      ready: models.ready,
      current,
      recent,
      list: models.list,
      cycle(direction: 1 | -1) {
        const recentList = recent()
        const currentModel = current()
        if (!currentModel) return

        const index = recentList.findIndex(
          (x) => x?.provider.id === currentModel.provider.id && x?.id === currentModel.id,
        )
        if (index === -1) return

        let next = index + direction
        if (next < 0) next = recentList.length - 1
        if (next >= recentList.length) next = 0

        const value = recentList[next]
        if (!value) return

        writeModel({
          providerID: value.provider.id,
          modelID: value.id,
        })
      },
      set: writeModel,
      visible(model: ModelKey) {
        return models.visible(model)
      },
      setVisibility(model: ModelKey, visible: boolean) {
        models.setVisibility(model, visible)
      },
      variant: {
        configured() {
          const a = agent.current()
          const m = current()
          if (!a || !m) return undefined
          return getConfiguredAgentVariant({
            agent: { model: a.model, variant: a.variant },
            model: { providerID: m.provider.id, modelID: m.id, variants: m.variants },
          })
        },
        selected() {
          const value = pick()?.variant
          if (value !== undefined) return value
          return base()?.variant
        },
        current() {
          return resolveModelVariant({
            variants: this.list(),
            selected: this.selected(),
            configured: this.configured(),
          })
        },
        list() {
          const m = current()
          if (!m?.variants) return []
          return Object.keys(m.variants)
        },
        set: writeVariant,
        cycle() {
          const variants = this.list()
          if (variants.length === 0) return
          this.set(
            cycleModelVariant({
              variants,
              selected: this.selected(),
              configured: this.configured(),
            }),
          )
        },
      },
    }

    const result = {
      slug: createMemo(() => base64Encode(sdk.directory)),
      model,
      agent,
      session: {
        promote(dir: string, id: string) {
          const draft = saved.pick[WORKSPACE_KEY]
          if (!draft) return
          batch(() => {
            const next = { ...draft, agent: draft.agent ?? store.current }
            if (dir === sdk.directory) write("pick", id, next)
            if (dir !== sdk.directory) setHandoff("pick", handoffKey(dir, id), next)
            setSaved("pick", WORKSPACE_KEY, undefined)
          })
        },
      },
    }

    if (modelEnabled()) {
      createEffect(() => {
        const agent = result.agent.current()
        const model = result.model.current()
        modelProbe.set({
          sessionID: sid(),
          agent: agent?.name,
          model: model
            ? {
                providerID: model.provider.id,
                modelID: model.id,
                name: model.name,
              }
            : undefined,
          variant: result.model.variant.current() ?? null,
          selected: result.model.variant.selected(),
          configured: result.model.variant.configured(),
          pick: pick(),
          base: base(),
          current: store.current,
        })
      })

      onCleanup(() => modelProbe.clear())
    }

    return result
  },
})

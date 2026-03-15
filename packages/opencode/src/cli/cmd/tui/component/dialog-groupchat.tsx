import { TextAttributes, RGBA, ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { batch, createMemo, createSignal, For, Show } from "solid-js"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import type { CatalogAgent } from "@/catalog"
import { groupByDepartment } from "@/catalog"
import * as fuzzysort from "fuzzysort"

export interface AgentPickerProps {
  agents: CatalogAgent[]
  onConfirm: (selected: CatalogAgent[], observers: string[]) => void
}

export function DialogGroupchat(props: AgentPickerProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  // Use createSignal for Set — Sets are not proxied by Solid stores
  const [selected, setSelected] = createSignal(new Set<string>())
  const [observers, setObservers] = createSignal(new Set<string>(["HEIMDALL"]))
  const [query, setQuery] = createSignal("")
  const [cursor, setCursor] = createSignal(0)

  let inputRef: any
  let scroll: ScrollBoxRenderable | undefined

  // All agents flat, optionally filtered by fuzzy query
  const filtered = createMemo(() => {
    const needle = query().trim()
    if (!needle) return props.agents
    return fuzzysort
      .go(needle, props.agents, { keys: ["name", "department"] })
      .map((r) => r.obj)
  })

  // Reset cursor when filter changes
  // (intentionally not using createEffect with filtered dep to avoid infinite loop)
  const grouped = createMemo<[string, CatalogAgent[]][]>(() => {
    const map = groupByDepartment(filtered())
    return Array.from(map.entries())
  })

  // Flat list of agents for cursor navigation (preserving group order)
  const flat = createMemo(() => grouped().flatMap(([, agents]) => agents))

  const canConfirm = createMemo(() => {
    // Minimum 2 active participants (observers don't count)
    return selected().size >= 2
  })

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleObserver(id: string) {
    // HEIMDALL is always an observer; don't allow removal
    if (id === "HEIMDALL") return
    setObservers((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function confirm() {
    if (!canConfirm()) return
    const selectedAgents = props.agents.filter((a) => selected().has(a.id))
    props.onConfirm(selectedAgents, Array.from(observers()))
    dialog.clear()
  }

  function moveCursor(dir: number) {
    const len = flat().length
    if (len === 0) return
    const next = ((cursor() + dir) % len + len) % len
    setCursor(next)
    // Scroll to keep cursor visible
    if (!scroll) return
    const agent = flat()[next]
    if (!agent) return
    const target = scroll.getChildren().find((c) => c.id === agent.id)
    if (!target) return
    const y = target.y - scroll.y
    const half = Math.floor(scroll.height / 2)
    scroll.scrollBy(y - half)
  }

  useKeyboard((evt) => {
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) moveCursor(-1)
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) moveCursor(1)

    if (evt.name === "space") {
      evt.preventDefault()
      const agent = flat()[cursor()]
      if (agent) toggleSelected(agent.id)
    }

    if (evt.name === "tab") {
      evt.preventDefault()
      const agent = flat()[cursor()]
      if (agent && agent.id !== "HEIMDALL") toggleObserver(agent.id)
    }

    if (evt.name === "return") {
      evt.preventDefault()
      evt.stopPropagation()
      confirm()
    }
  })

  const maxHeight = createMemo(() => Math.floor(dimensions().height / 2) - 6)

  return (
    <box gap={1} paddingBottom={1}>
      {/* Header */}
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Start groupchat
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
        <box paddingTop={1}>
          <input
            onInput={(e) => {
              batch(() => {
                setQuery(e)
                setCursor(0)
              })
            }}
            focusedBackgroundColor={theme.backgroundPanel}
            cursorColor={theme.primary}
            focusedTextColor={theme.textMuted}
            ref={(r: any) => {
              inputRef = r
              setTimeout(() => {
                if (!inputRef) return
                if (inputRef.isDestroyed) return
                inputRef.focus()
              }, 1)
            }}
            placeholder="Search agents"
          />
        </box>
      </box>

      {/* Agent list grouped by department */}
      <Show
        when={grouped().length > 0}
        fallback={
          <box paddingLeft={4} paddingRight={4} paddingTop={1}>
            <text fg={theme.textMuted}>No agents found</text>
          </box>
        }
      >
        <scrollbox
          paddingLeft={1}
          paddingRight={1}
          scrollbarOptions={{ visible: false }}
          ref={(r: ScrollBoxRenderable) => (scroll = r)}
          maxHeight={maxHeight()}
        >
          <For each={grouped()}>
            {([department, agents], deptIndex) => (
              <>
                {/* Department header */}
                <box paddingTop={deptIndex() > 0 ? 1 : 0} paddingLeft={3}>
                  <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                    {department}
                  </text>
                </box>

                <For each={agents}>
                  {(agent) => {
                    const isActive = createMemo(
                      () => flat().indexOf(agent) === cursor(),
                    )
                    const isSelected = createMemo(() => selected().has(agent.id))
                    const isObserver = createMemo(() => observers().has(agent.id))
                    const fg = selectedForeground(theme)

                    return (
                      <box
                        id={agent.id}
                        flexDirection="row"
                        alignItems="center"
                        gap={1}
                        paddingLeft={2}
                        paddingRight={3}
                        backgroundColor={
                          isActive()
                            ? theme.primary
                            : RGBA.fromInts(0, 0, 0, 0)
                        }
                        onMouseDown={() => {
                          const idx = flat().indexOf(agent)
                          if (idx !== -1) setCursor(idx)
                        }}
                        onMouseUp={() => {
                          const idx = flat().indexOf(agent)
                          if (idx !== -1) setCursor(idx)
                          toggleSelected(agent.id)
                        }}
                      >
                        {/* Selection checkbox */}
                        <text
                          flexShrink={0}
                          fg={
                            isActive()
                              ? fg
                              : isSelected()
                                ? theme.success
                                : theme.textMuted
                          }
                        >
                          {isSelected() ? "■" : "□"}
                        </text>

                        {/* Agent name and persona */}
                        <text
                          flexGrow={1}
                          fg={isActive() ? fg : isSelected() ? theme.text : theme.textMuted}
                          attributes={
                            isActive() || isSelected()
                              ? TextAttributes.BOLD
                              : undefined
                          }
                          overflow="hidden"
                          wrapMode="none"
                        >
                          {agent.name}
                          <Show when={agent.role}>
                            <span
                              style={{
                                fg: isActive() ? fg : theme.textMuted,
                              }}
                            >
                              {" "}
                              {agent.role}
                            </span>
                          </Show>
                        </text>

                        {/* Tier badge */}
                        <text
                          flexShrink={0}
                          fg={isActive() ? fg : theme.textMuted}
                        >
                          {agent.tier}
                        </text>

                        {/* Observer badge — shown for HEIMDALL always, or when toggled */}
                        <Show when={isObserver()}>
                          <text
                            flexShrink={0}
                            fg={isActive() ? fg : theme.info}
                          >
                            observer
                          </text>
                        </Show>
                      </box>
                    )
                  }}
                </For>
              </>
            )}
          </For>
        </scrollbox>
      </Show>

      {/* Footer: status + keybinds */}
      <box
        paddingRight={2}
        paddingLeft={4}
        flexDirection="row"
        gap={2}
        flexShrink={0}
        paddingTop={1}
        justifyContent="space-between"
      >
        {/* Participant count + confirm hint */}
        <text fg={canConfirm() ? theme.success : theme.textMuted}>
          {selected().size} selected
          <Show when={!canConfirm()}>
            <span style={{ fg: theme.textMuted }}> (min 2)</span>
          </Show>
        </text>

        <box flexDirection="row" gap={2}>
          <text>
            <span style={{ fg: theme.text }}>
              <b>toggle</b>{" "}
            </span>
            <span style={{ fg: theme.textMuted }}>space</span>
          </text>
          <text>
            <span style={{ fg: theme.text }}>
              <b>observer</b>{" "}
            </span>
            <span style={{ fg: theme.textMuted }}>tab</span>
          </text>
          <text>
            <span
              style={{ fg: canConfirm() ? theme.primary : theme.textMuted }}
            >
              <b>confirm</b>{" "}
            </span>
            <span style={{ fg: theme.textMuted }}>enter</span>
          </text>
        </box>
      </box>
    </box>
  )
}

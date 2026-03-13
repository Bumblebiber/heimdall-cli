import type { Locator, Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { sessionIDFromUrl, waitSessionIdle } from "../actions"
import { promptAgentSelector, promptModelSelector, promptSelector, promptVariantSelector } from "../selectors"
import { createSdk } from "../utils"

type State = {
  agent: string
  model: string
  variant: string
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const text = async (locator: Locator) => ((await locator.textContent()) ?? "").trim()

async function variantCount(page: Page) {
  const select = page.locator(promptVariantSelector)
  await expect(select).toBeVisible()
  await select.locator('[data-slot="select-select-trigger"]').click()
  const count = await page.locator('[data-slot="select-select-item"]').count()
  await page.keyboard.press("Escape")
  return count
}

async function agents(page: Page) {
  const select = page.locator(promptAgentSelector)
  await expect(select).toBeVisible()
  await select.locator('[data-action], [data-slot="select-select-trigger"]').first().click()
  const labels = await page.locator('[data-slot="select-select-item-label"]').allTextContents()
  await page.keyboard.press("Escape")
  return labels.map((item) => item.trim()).filter(Boolean)
}

async function read(page: Page): Promise<State> {
  return {
    agent: await text(page.locator(`${promptAgentSelector} [data-slot="select-select-trigger-value"]`).first()),
    model: await text(page.locator(`${promptModelSelector} [data-action="prompt-model"] span`).first()),
    variant: await text(page.locator(`${promptVariantSelector} [data-slot="select-select-trigger-value"]`).first()),
  }
}

async function wait(page: Page, expected: Partial<State>): Promise<State> {
  let hit: State | null = null
  await expect
    .poll(
      async () => {
        const state = await read(page)
        const ok = Object.entries(expected).every(([key, value]) => state[key as keyof State] === value)
        if (ok) hit = state
        return ok
      },
      { timeout: 30_000 },
    )
    .toBe(true)
  if (!hit) throw new Error("Failed to resolve prompt footer state")
  return hit
}

async function choose(page: Page, root: string, value: string) {
  const select = page.locator(root)
  await expect(select).toBeVisible()
  await select.locator('[data-action], [data-slot="select-select-trigger"]').first().click()
  const item = page
    .locator('[data-slot="select-select-item"]')
    .filter({ hasText: new RegExp(`^\\s*${escape(value)}\\s*$`) })
    .first()
  await expect(item).toBeVisible()
  await item.click()
}

async function ensureVariant(page: Page, directory: string) {
  const current = await read(page)
  if ((await variantCount(page)) >= 2) return current

  const cfg = await createSdk(directory)
    .config.get()
    .then((x) => x.data)
  const visible = new Set(await agents(page))
  const entry = Object.entries(cfg?.agent ?? {}).find((item) => {
    const value = item[1]
    return !!value && typeof value === "object" && "variant" in value && "model" in value && visible.has(item[0])
  })
  const name = entry?.[0]
  test.skip(!name, "no agent with alternate variants available")
  if (!name) return current

  await choose(page, promptAgentSelector, name)
  await expect.poll(() => variantCount(page), { timeout: 30_000 }).toBeGreaterThanOrEqual(2)
  return wait(page, { agent: name })
}

async function chooseDifferentVariant(page: Page) {
  const current = await read(page)
  const select = page.locator(promptVariantSelector)
  await expect(select).toBeVisible()
  await select.locator('[data-slot="select-select-trigger"]').click()

  const items = page.locator('[data-slot="select-select-item"]')
  const count = await items.count()
  if (count < 2) throw new Error("Current model has no alternate variant to select")

  for (let i = 0; i < count; i++) {
    const item = items.nth(i)
    const next = await text(item.locator('[data-slot="select-select-item-label"]').first())
    if (!next || next === current.variant) continue
    await item.click()
    return wait(page, { agent: current.agent, model: current.model, variant: next })
  }

  throw new Error("Failed to choose a different variant")
}

async function chooseOtherModel(page: Page) {
  const current = await read(page)
  const button = page.locator(`${promptModelSelector} [data-action="prompt-model"]`)
  await expect(button).toBeVisible()
  await button.click()

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()

  const items = dialog.locator('[data-slot="list-item"]')
  const count = await items.count()
  expect(count).toBeGreaterThan(1)

  for (let i = 0; i < count; i++) {
    const item = items.nth(i)
    const next = await text(item.locator("span").first())
    if (!next || next === current.model) continue
    await item.click()
    await expect(dialog).toHaveCount(0)
    return wait(page, { agent: current.agent, model: next })
  }

  throw new Error("Failed to choose a different model")
}

async function submit(page: Page, textValue: string) {
  const prompt = page.locator(promptSelector)
  await expect(prompt).toBeVisible()
  await prompt.click()
  await prompt.fill(textValue)
  await prompt.press("Enter")

  await expect.poll(() => sessionIDFromUrl(page.url()) ?? "", { timeout: 30_000 }).not.toBe("")
  const id = sessionIDFromUrl(page.url())
  if (!id) throw new Error(`Failed to resolve session id from ${page.url()}`)
  return id
}

async function waitUser(directory: string, sessionID: string) {
  const sdk = createSdk(directory)
  await expect
    .poll(
      async () => {
        const items = await sdk.session.messages({ sessionID, limit: 20 }).then((x) => x.data ?? [])
        return items.some((item) => item.info.role === "user")
      },
      { timeout: 30_000 },
    )
    .toBe(true)
  await sdk.session.abort({ sessionID }).catch(() => undefined)
  await waitSessionIdle(sdk, sessionID, 30_000).catch(() => undefined)
}

test("session model and variant restore per session without leaking into new sessions", async ({
  page,
  withProject,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })

  await withProject(async ({ directory, gotoSession, trackSession }) => {
    await gotoSession()

    const initial = await ensureVariant(page, directory)
    const firstState = await chooseDifferentVariant(page)

    const first = await submit(page, `session variant ${Date.now()}`)
    trackSession(first)
    await waitUser(directory, first)

    await page.reload()
    await expect(page.locator(promptSelector)).toBeVisible()
    await wait(page, firstState)

    await gotoSession()
    await wait(page, initial)

    const secondState = await chooseOtherModel(page)

    const second = await submit(page, `session model ${Date.now()}`)
    trackSession(second)
    await waitUser(directory, second)

    await gotoSession(first)
    await wait(page, firstState)

    await gotoSession(second)
    await wait(page, secondState)

    await gotoSession()
    await wait(page, initial)
  })
})

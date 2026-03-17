import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"

// Em-spaces (U+2003) between runes — these don't collapse in terminal renderers
const SEP = "\u2003\u2003\u2003"

export function Logo() {
  const { theme } = useTheme()

  const heim = ["ᚺ", "ᛖ", "ᛁ", "ᛗ"].join(SEP) + SEP
  const dall = ["ᛞ", "ᚨ", "ᛚ", "ᛚ"].join(SEP)

  return (
    <box alignItems="center" flexDirection="column">
      <text> </text>
      <box alignItems="center" flexDirection="row">
        <text fg={theme.textMuted} attributes={TextAttributes.BOLD} selectable={false}>
          {heim}
        </text>
        <text fg={theme.text} attributes={TextAttributes.BOLD} selectable={false}>
          {dall}
        </text>
      </box>
      <text> </text>
    </box>
  )
}

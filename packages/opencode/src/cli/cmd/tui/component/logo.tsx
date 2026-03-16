import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"

export function Logo() {
  const { theme } = useTheme()

  return (
    <box alignItems="center">
      <text fg={theme.textMuted} attributes={TextAttributes.BOLD} selectable={false}>
        ᚺ   ᛖ   ᛁ   ᛗ   ᛞ   ᚨ   ᛚ   ᛚ
      </text>
    </box>
  )
}

import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"

export function Logo() {
  const { theme } = useTheme()

  return (
    <box alignItems="center" flexDirection="row">
      <text fg={theme.textMuted} attributes={TextAttributes.BOLD} selectable={false}>
        ᚺ   ᛖ   ᛁ   ᛗ   </text>
      <text fg={theme.text} attributes={TextAttributes.BOLD} selectable={false}>
        ᛞ   ᚨ   ᛚ   ᛚ</text>
    </box>
  )
}

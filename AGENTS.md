<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Studio interface boundary

- Preserve the existing interface at `https://lenslab.dev/studio`. It is the visual reference, not an invitation to redesign.
- Keep the original header, left Assistant rail, right drop target/contact sheet, loupe, and edit desk, including typography, colors, spacing, and responsive layout.
- Performance and feature work belongs behind that interface. C++ applies to the processing engine; retain the existing web interface.
- Keep new secondary actions in existing menus and show progress/proposal controls only when relevant. Do not replace the Studio with a centered chat hero or a native desktop redesign without an explicit new request.
- Preserve folder-drop traversal, saved shoots, undo, Adobe-settings parsing, and approval of proposed edits when changing presentation. Never restore entire historical files to recover styling.

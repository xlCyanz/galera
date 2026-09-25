# Cambios

Todo lo que cambia de una versión a otra, sacado de los commits: cada PR
entra en `main` como un commit con el formato de
[Conventional Commits](https://www.conventionalcommits.org/es/v1.0.0/), y de
su tipo sale la sección. Se genera con `git-cliff`: no se edita a mano.

## Sin publicar

### Novedades

- **core:** Set up the Cargo workspace with galera-core and galera-cli (#101)
- **model:** Define the document model with serde (#103)
- **codegen:** Escape user text before it reaches Typst markup (#104)
- **codegen:** Emit the document skeleton and its pages (#105)
- **codegen:** Emit rect, ellipse and line (#106)
- **codegen:** Emit plain text blocks (#107)
- **codegen:** Emit images from project assets (#108)
- **codegen:** Evaluate custom code blocks in isolation (#109)
- **world:** Implement typst::World over the project folder (#110)
- **project:** Serve project files through World behind one path check (#111)
- **compile:** Compile documents to PDF (#112)
- **compile:** Export pages to SVG from the same compilation (#113)
- **cli:** Convert documents to PDF or SVG from the terminal (#114)
- **model:** Validate documents before compiling them (#116)
- **core:** One error type with diagnostics attributed to elements (#117)
- **tauri:** Scaffold the desktop app with React, TypeScript and Vite (#118)
- **tauri:** Link galera-core and share state across commands (#119)
- **tauri:** Open a project folder chosen in the native dialog (#121)
- **tauri:** Compile once per revision and render pages as SVG (#122)
- **tauri:** Export the open document to PDF (#123)
- **core:** Generate the TypeScript types of the model with ts-rs (#124)
- **ui:** Add Zustand stores for the document and the compilation (#125)
- **canvas:** Show the current page centered with the Typst SVG (#126)
- **canvas:** Zoom from 25 % to 800 % toward the pointer, and pan (#127)
- **canvas:** Add millimeter rulers with the pointer position (#128)
- **tauri:** Compile in the background and report with events (#129)
- **ui:** Status bar and error panel with links to the failing element (#130)
- **core:** Layout module with the real box of every element (#131)
- **ui:** Send element boxes with each compilation and keep them in a store (#132)
- **core:** Hit-test a point of the page to the element under it (#133)
- **canvas:** Control layer with outline, eight handles and rotation handle (#134)
- **core:** Edit commands that return how to undo them (#135)
- **canvas:** Move elements with an optimistic drag (#136)
- **canvas:** Resize elements with the eight handles (#137)
- **canvas:** Rotate elements with the rotation handle (#138)
- **ops:** Undo and redo history with grouped steps (#139)
- **ui:** Inspector for position, size and rotation (#140)
- **ui:** Tool rail with one-key shortcuts (#142)
- **canvas:** Create rectangles, ellipses and lines by dragging (#143)
- **canvas:** Create text boxes and add a font when the project has none (#144)
- **canvas:** Insert images by dropping them or with the image tool (#145)
- **ui:** Layers panel with synced selection and drag to reorder (#146)
- **model:** Hide, lock and rename elements from the layers panel (#147)
- **ui:** Assets panel to list, add, rename and remove project images (#148)
- **ui:** Fonts panel with Typst samples and a project-only font picker (#149)
- **ui:** Shape inspector with color picker, border style and radius (#150)
- **ui:** Text inspector for font, size, color, alignment and spacing (#151)
- **project:** .galera format, save, save as and open both formats (#152)
- **tauri:** Autosave with recovery and a guard when closing (#153)
- **ui:** One shortcut registry, a help sheet and docs/atajos.md (#154)
- **project:** Create an empty project from the app (#161)
- **ops:** Edit the document title from the inspector (#162)
- **canvas:** Create code blocks and edit their Typst source (#163)
- **ops:** See and edit the document's variables (#164)
- **ops:** Change an element's id from the inspector (#165)
- **layout:** Glyph positions from the Typst layout (#166)
- **text:** Spike for keyboard and IME input inside the webview (#167)
- **text:** Type into a text element through an invisible field (#168)
- **model:** Text operations over runs, counted in characters (#169)
- **text:** Draw the caret where Typst says the glyphs are (#171)
- **text:** Select text with the pointer, drawn over Typst's glyphs (#172)
- **text:** Bold, italic, underline and colour, run by run (#173)
- **text:** Links in a run, kept as links in the PDF (#175)
- **text:** Bulleted and numbered lists, with nesting (#176)
- **layout:** Warn when the content does not fit its box (#177)
- **snap:** Work out what a moving element snaps to, and the guides to draw (#180)
- **canvas:** Smart guides while moving and resizing (#181)
- **canvas:** Select several elements and change them together (#182)
- **model:** Groups, with their children inside and their own transform (#183)
- **ops:** Align and spread several elements at once (#184)
- **ops:** Add, duplicate, reorder and remove pages (#185)
- **core:** Copy, cut, paste and duplicate, across documents (#186)
- **ui:** Show the generated Typst code, read only (#187)
- **ui:** Edit a code block with CodeMirror, errors on their own line (#188)
- **model:** Variables with a kind, and a panel that knows where they are used (#189)
- **codegen:** Substitute {{variable}} chips, escaped, and edit them whole (#190)
- **core:** Templates, with their gallery and a document of your own (#191)
- **core:** Read a CSV and match its columns to the variables (#192)
- **core:** Generate a batch of documents, one PDF per row or all in one (#193)
- **core:** Export to SVG, PNG and .typ, of the pages that are asked for (#194)
- **model:** A flow of text through a chain of zones, and its commands (#195)
- **codegen:** Text that flows from one zone to the next, cut by Typst (#196)
- **text:** Write a flow as one text, across its zones and its pages (#197)
- **model:** Tables, a grid of cells that Typst measures (#198)
- **ui:** Write inside a table, cell by cell, where Typst put it (#199)
- **project:** Six templates that open, compose and carry their own fonts (#201)
- **text:** The IME spike takes notes, so the hands-on session leaves a report (#204)
- **ui:** A dark theme, with every colour of the interface in one file (#205)
- **ui:** The whole app by keyboard, with the focus always in sight (#206)
- **ui:** Names, contrast and announcements a screen reader can use (#207)

### Arreglos

- **text:** The format of a selection is a range of characters, not of bytes (#200)

### Rendimiento

- **compile:** Keep the compiler between changes and draw only what changed (#170)
- **core:** Bench the whole keystroke, and write down what it costs (#178)
- **tauri:** Send the interface only the pages it does not have (#210)

### Documentación

- Add project banner and update README with detailed project over… (#102)
- Phase 3 exit criterion analysis and the gaps it found (#160)

### Pruebas

- **core:** Snapshot every fixture and make them all compile (#115)
- **ops:** A hundred commands undone leave the same bytes (#141)
- **layout:** Check the editor's line breaks against the exported PDF (#179)
- **core:** Build the example document with commands alone, no hand-written JSON (#203)
- **core:** Measure a 50-page document, open to export (#209)
- **core:** Compare keystroke timings on the same machine, not with a fixed budget (#211)

### Compilación y distribución

- Exclude dependabot from the PR title check (#100)
- **ci:** A universal macOS dmg, signed and notarized (#212)
- **ci:** A Windows installer, and the same PDF on every system (#213)

### Dependencias

- **deps:** Bump @types/node from 24.13.5 to 26.5.1 in the dev-dependencies group (#120)
- **deps:** Bump the dev-dependencies group with 2 updates (#202)



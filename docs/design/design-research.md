# FIS document-first refresh

The first-time learner needs to turn a PDF into a question with a verifiable source, then practice and resume later. The previous home screen led with the prepared lesson and repeated its link in the navigation, task cards and empty course list. The new home gives their own material the most visible action and explains where to continue afterwards.

## References inspected on 19 November 2026

- **Things 3, Cultured Code**. Banani screenshots visually inspected. The onboarding screens highlight one destination at a time while preserving the familiar list beneath. Adapt the clear path from start to resume without copying icons or visuals. [Things 3 gallery](https://www.banani.co/references/apps/things-3)
- **Notion blog index header, Notion**. The UI Index text metadata describes a divider and a restrained topic row below the heading. The browser was blocked with 403. Adapt a quiet divider between the active task and its alternatives. [Notion header](https://theuiindex.com/elements/7f3277b9-8614-442e-84a8-ffd8054cc48d/blog-index-header-title-intro-and-topic-tabs-notion)
- **Document Upload Modal, Nachi**. Pixlpin text metadata describes a file intake control and separately labeled PDF states. The browser was blocked with 403. Adapt clear file state and progress while using a page with inline actions. [Upload component](https://pixlpin.com/d/document-upload-modal-component)
- **Workflow**. Lapa Ninja lists the site under gray and white and describes handing off work for review. The browser was blocked with 403. Use the existing FIS monochrome brief as the actual palette source. [Workflow](https://www.lapa.ninja/post/workflow/)

## Directions

- **Focused study desk** places the upload action beside a compact paper-like sequence showing document, source and practice. It uses the established system sans for labels and a firm editorial display scale. The paper sequence becomes secondary on small screens. The design favors a straightforward first visit and leaves course switching in its own section.
- **Course library** puts a dense course list and recent items first, with upload as a utility action. It would help returning students scan a larger collection. For a new visitor with an empty workspace, it would hide the first useful step behind a management view.

The focused study desk keeps document upload prominent and makes the new journey usable without sign-in. It uses `#FAFAFA` and white surfaces in light mode, near-black and charcoal in dark mode, muted text with verified contrast, and a distinct form-control boundary. The author's FIS logo geometry remains intact. Text, icon and border shape convey state. No external assets are used.

## Acceptance

At widths 360, 390, 768, 1024 and 1440 px, the primary action stays visible and the page fits horizontally. Upload, progress and errors remain in the document intake and course workflow. Keyboard users can open and close navigation and pick an existing course. Arabic uses logical spacing and the application direction. Theme and reduced motion respect user preferences. A failed upload retains the chosen file and destination for a retry, and an indexed document gives the learner a contextual path to the tutor.

## Learning workspace overhaul, 23 November 2026

The learner's primary job is to turn a page from their own PDF into an explanation they can check, then practice the concept. The existing monochrome tokens, system typography, and FIS mark carry through this refresh. The original PDF and its cited passage provide the central visual reference.

### Reference evidence

- **FIS Learning baseline** · VISUALLY INSPECTED in the existing desktop and mobile screenshots and current browser journey. When a learner opened a citation, the separate viewer covered the entire study context. The new layout keeps the answer available beside the source or underneath a dismissible mobile drawer.
- **NotebookLM source citations, Google** · TEXT-ONLY. Google's product documentation describes a citation that opens the supporting passage. Adapt direct passage navigation in the private FIS viewer. [Product announcement](https://blog.google/innovation-and-ai/products/notebooklm-goes-global-support-for-websites-slides-fact-check/)
- **Document Upload Modal, Nachi** · TEXT-ONLY. Pixlpin shows separate labels for choosing a file and reviewing file state. Adapt a visible browse/drop control and an inline transfer status. [Pixlpin reference](https://pixlpin.com/d/document-upload-modal-component)
- **Mightybytes mobile form, The UI Index** · TEXT-ONLY catalog and source blocked with HTTP 403. No visual or interaction claims from this source. [Catalog entry](https://theuiindex.com/elements/fe566c79-2ef1-401d-9060-46487900bf30/contact-form-with-name-email-and-company-fields-mobile-mightybytes)

### Directions and implementation

- **Study desk**, selected. Materials and topics sit next to a tutor with a readable question and answer column. The cited PDF enters as a secondary panel at wide sizes and a keyboard-accessible drawer at narrow sizes. White paper and subdued dividers provide hierarchy in light mode. Existing charcoal surfaces and brighter outlines provide the same structure in dark mode. The narrower source panel sacrifices reading width, so a full-page viewer stays available.
- **Reading room**. A persistent large PDF surface would support page-by-page reading with chat and practice below or beside it. The same neutral palette, compact heading typography and footnote-like citations would suit long readings. This puts a PDF at the center even before the learner asks a question, adding navigation and space costs on smaller screens.

Adopt the practical interaction patterns of returning to the triggering citation, using actual processing checkpoints, and keeping optional setup in disclosure. Adapt the current FIS surfaces and type scale. Use CSS breakpoints and existing reduced-motion preferences. Source content and help steps remain available by keyboard. At 360, 390, 768, 1024, and 1440 pixels check scroll width, original-page highlighting, the active composer's visibility, and RTL placement.

### Guided tour choice

Driver.js offers configurable step focus, keyboard navigation and element-based spotlight overlays. FIS uses an optional, three-step browser-native `<dialog>` that can be reopened via Help while the study routes load independently. Native modal behavior supplies the backdrop, background inertness and Escape dismissal. The component owns localized steps, persisted dismissal and explicit focus return. That avoids fragile cross-route target selectors and a dependency for the short tour. [Driver.js configuration](https://driverjs.com/docs/configuration) · [WAI-ARIA dialog guidance](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) · [MDN showModal](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal)

## Course starters refresh, 24 November 2026

- **FIS Recovery laboratory, FIS Learning** · VISUALLY INSPECTED at 390px with a synthetic saved outline. Five of six starters repeated the title. The draft was replaced when a starter was chosen.
- **NotebookLM suggested questions, Google** · TEXT-ONLY. The product guide uses questions from uploaded sources to help a learner start. FIS pairs each starter with its source page. [Google NotebookLM guide](https://blog.google/innovation-and-ai/products/notebooklm-beginner-tips/)
- **Copilot message composition, Microsoft** · TEXT-ONLY. The documentation separates applying a suggestion from sending it. FIS keeps that review step in the existing tutor composer. [Microsoft Teams composition guide](https://support.microsoft.com/en-us/teams/copilot/rewrite-and-adjust-your-messages-with-copilot-in-microsoft-teams)

The selected design puts three source-backed actions immediately above the existing composer. Concept explanations, measured comparisons and study checks give learners distinct reasons to choose an action. System typography, monochrome tokens and the existing heading hierarchy carry through. The actions stack on small screens and use available columns on larger screens. Older saved outlines can be refined in the authorized course response from existing evidence.

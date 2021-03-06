import {Format} from "./format";
import {RunUI} from "../run_ui";
import {Weya as $} from "../../lib/weya/weya";
import {CodeMirror} from "../codemirror";
import {clearCache} from "../cache";
import {SelectListeners, SyncListeners} from "./table_view";
import {API} from "../app";
import {Run} from "../../common/experiments";

export class ControlsView implements SelectListeners {
    private elem: HTMLElement
    private codemirror: any
    private format: Format
    private syncListeners: SyncListeners
    private codemirrorDiv: HTMLElement
    private selectedCountElem: HTMLElement
    private selectedRuns: { [hash: string]: RunUI }
    private tensorboardBtn: HTMLButtonElement
    private searchInput: HTMLInputElement;
    private syncControls: HTMLElement
    private editorControls: HTMLElement;
    private actionsElem: HTMLElement;
    private actionsContainer: HTMLElement;
    private removeBtn: HTMLButtonElement;
    private cleanupCheckpointsBtn: HTMLButtonElement;
    private cleanupArtifactsBtn: HTMLButtonElement;

    constructor(format: Format, syncListeners: SyncListeners) {
        this.format = format
        this.syncListeners = syncListeners
        this.selectedRuns = {}
    }

    onSelect(run: RunUI) {
        this.selectedRuns[run.run.hash()] = run
        this.updateSelectedRunsCount()
    }

    onUnSelect(run: RunUI) {
        delete this.selectedRuns[run.run.hash()]
        this.updateSelectedRunsCount()
    }

    render(): HTMLElement {
        this.elem = <HTMLElement>$('div.control_panel', $ => {
            this.editorControls = <HTMLElement>$('div.editor_controls', $ => {
                $('i.fa.fa-edit', {on: {click: this.onEdit}})
                this.syncControls = <HTMLElement>$('span', $ => {
                    $('i.fa.fa-sync', {on: {click: this.onSync}})
                    $('i.fa.fa-save', {on: {click: this.onSave}})
                })
            })
            this.codemirrorDiv = <HTMLElement>$('div.editor')

            $('div.search', $ => {
                $('div.input-container', $ => {
                    $('i.input-icon.fa.fa-search')
                    this.searchInput = <HTMLInputElement>$('input', {
                        type: 'text',
                        on: {
                            keyup: this.onSearchKeyUp
                        }
                    })
                })
            })

            this.actionsContainer = <HTMLElement>$('div.actions-container', $ => {
                this.actionsElem = <HTMLElement>$('div.actions', $ => {
                    this.tensorboardBtn = <HTMLButtonElement>(
                        $('button',
                            {on: {click: this.onTensorboard}},
                            $ => {
                                $('i.fa.fa-chart-bar')
                                $('span', ' Launch Tensorboard')
                            })
                    )

                    this.removeBtn = <HTMLButtonElement>$('button.danger',
                        {on: {click: this.onRemove}},
                        $ => {
                            $('i.fa.fa-trash')
                            $('span', ' Remove')
                        }
                    )

                    this.cleanupCheckpointsBtn = <HTMLButtonElement>$('button.danger',
                        {on: {click: this.onCleanupCheckpoints}},
                        $ => {
                            $('i.fa.fa-trash')
                            $('span', ' Cleanup Checkpoints')
                        }
                    )

                    this.cleanupArtifactsBtn = <HTMLButtonElement>$('button.danger',
                        {on: {click: this.onCleanupArtifacts}},
                        $ => {
                            $('i.fa.fa-trash')
                            $('span', ' Cleanup Artifacts')
                        }
                    )
                })
                this.selectedCountElem = <HTMLElement>$('div.selected_count', 'No runs selected')
            })
        })

        this.codemirror = CodeMirror(this.codemirrorDiv, {
                mode: "yaml",
                theme: "darcula"
            }
        )

        this.codemirrorDiv.style.display = 'none'
        this.syncControls.style.display = 'none'
        this.editorControls.style.float = 'right'

        this.updateSelectedRunsCount()

        return this.elem
    }

    onSearchKeyUp = async (e: KeyboardEvent) => {
        // if (e.key === 'Enter') {
        //     this.saveComment(this.commentInput.value)
        // }
        let search = this.searchInput.value
        let terms: string[] = []
        for (let t of search.split(' ')) {
            t = t.trim()
            if (t !== '') {
                terms.push(t)
            }
        }

        this.resetSelection()

        this.syncListeners.setFilter(terms)
    }

    setSearch(search: string) {
        this.searchInput.value = search
    }

    updateFormat() {
        this.codemirror.setValue(this.format.toYAML())
    }

    onTensorboard = async () => {
        let runs: string[] = []
        for (let r in this.selectedRuns) {
            let run: Run = this.selectedRuns[r].run
            runs.push(run.uuid)
        }

        let url = await API.launchTensorboards(runs)
        if (url === '') {
            alert("Couldn't start Tensorboard")
        } else {
            window.open(url, '_blank')
        }
    }

    onRemove = async (e: Event) => {
        let count = this.getSelectedRunsCount()
        if (confirm(`Do you want to remove ${count} runs?`)) {
            this.syncListeners.onChanging()
            for (let run of Object.values(this.selectedRuns)) {
                await run.remove()
            }
            this.resetSelection()
            clearCache()
            this.syncListeners.onReload()
        }
    }

    onCleanupCheckpoints = async (e: Event) => {
        this.syncListeners.onChanging()
        for (let r in this.selectedRuns) {
            let run: RunUI = this.selectedRuns[r]
            await run.cleanupCheckpoints()
        }
        this.resetSelection()
        clearCache()
        this.syncListeners.onReload()
    }

    onCleanupArtifacts = async (e: Event) => {
        this.syncListeners.onChanging()
        for (let r in this.selectedRuns) {
            let run: RunUI = this.selectedRuns[r]
            await run.cleanupArtifacts()
        }
        this.resetSelection()
        clearCache()
        this.syncListeners.onReload()
    }

    onSync = (e: Event) => {
        e.preventDefault()
        e.stopPropagation()

        console.log("Sync")
        this.format.update(this.codemirror.getValue())
        this.syncListeners.onSync(this.format.dashboard)
    }

    onEdit = (e: Event) => {
        e.preventDefault()
        e.stopPropagation()

        if (this.codemirrorDiv.style.display === 'none') {
            this.syncControls.style.display = null
            this.codemirrorDiv.style.display = null
            this.editorControls.style.float = null
            this.codemirror.setValue(this.format.toYAML())
            this.codemirror.focus()
        } else {
            this.syncControls.style.display = 'none'
            this.codemirrorDiv.style.display = 'none'
            this.editorControls.style.float = 'right'
        }
    }

    onSave = (e: Event) => {
        e.preventDefault()
        e.stopPropagation()

        console.log("Sync")
        this.format.update(this.codemirror.getValue())
        this.syncListeners.onSync(this.format.dashboard)
        this.format.save().then()
    }

    private getSelectedRunsCount() {
        let count = 0
        for (let r of Object.keys(this.selectedRuns)) {
            count++
        }

        return count
    }

    private updateSelectedRunsCount() {
        let count = this.getSelectedRunsCount()
        if (count === 0) {
            this.tensorboardBtn.disabled = true
            this.cleanupCheckpointsBtn.disabled = true
            this.cleanupArtifactsBtn.disabled = true
            this.removeBtn.disabled = true
            this.selectedCountElem.classList.remove('items-selected')
        } else {
            this.tensorboardBtn.disabled = false
            this.cleanupCheckpointsBtn.disabled = false
            this.cleanupArtifactsBtn.disabled = false
            this.removeBtn.disabled = false
            this.selectedCountElem.classList.add('items-selected')
        }

        if (count === 0) {
            this.selectedCountElem.textContent = `No runs selected`
        } else if (count == 1) {
            this.selectedCountElem.textContent = `One run selected`
        } else {
            this.selectedCountElem.textContent = `${count} runs selected`
        }
    }

    private resetSelection() {
        this.selectedRuns = {}
        this.updateSelectedRunsCount()
    }
}
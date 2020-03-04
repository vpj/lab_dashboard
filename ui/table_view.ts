import {ScreenView} from './screen'
import {ROUTER, SCREEN} from './app'
import {Weya as $, WeyaElement} from '../lib/weya/weya'
import {Experiments} from '../common/experiments'
import {getExperiments} from './cache'
import {RunUI} from "./run_ui";
import {Cell, CellFactory, CellOptions} from "./cells/cell";

class RunView {
    elem: WeyaElement
    run: RunUI
    private controls: HTMLElement;
    private selectIcon: HTMLElement;
    private isSelected: boolean;

    constructor(r: RunUI) {
        this.run = r
        this.isSelected = false
    }

    render(format: Cell[]) {
        this.elem = $('div.row', $ => {
                for (let cell of format) {
                    if (cell.type === 'controls') {
                        this.controls = cell.renderCell($, this.run)
                    } else {
                        cell.renderCell($, this.run)
                    }
                }
            }
        )

        this.controls.innerHTML = ''
        $('span', this.controls, $ => {
            this.selectIcon = <HTMLElement>$('i.fa.fa-square', {on: {click: this.onSelect}})
        })

        return this.elem
    }

    onSelect = (e: Event) => {
        e.preventDefault()
        e.stopPropagation()

        this.isSelected = !this.isSelected

        this.selectIcon.classList.remove('fa-square')
        this.selectIcon.classList.remove('fa-check-square')
        if (this.isSelected) {
            this.selectIcon.classList.add('fa-check-square')
        } else {
            this.selectIcon.classList.add('fa-square')
        }
    }

    onOpen = (e: Event) => {
        e.preventDefault()
        e.stopPropagation()

        ROUTER.navigate(`/experiment/${this.run.run.experimentName}/${this.run.run.info.uuid}`)
    }

}

interface ControlsListeners {
    onSelect(run: RunUI)

    onUnSelect(run: RunUI)
}

class ControlsView implements ControlsListeners {
    private elem: HTMLElement

    onSelect(run: RunUI) {
    }

    onUnSelect(run: RunUI) {
    }

    render(): HTMLElement {
        this.elem = <HTMLElement>$('div', $ => {
            $('h1', "Controls")
        })

        return this.elem
    }
}

class RunsView implements ScreenView {
    elem: HTMLElement
    runsTable: HTMLElement
    runs: RunUI[]
    format: Cell[]

    render(): WeyaElement {
        this.elem = <HTMLElement>$('div.full_container', $ => {
            let controls = <HTMLElement>$('div.controls')
            controls.appendChild(new ControlsView().render())
            this.runsTable = <HTMLElement>$('div.table')
        })

        this.renderExperiments().then()
        return this.elem
    }

    private static getRuns(experiments: Experiments) {
        let runUIs = []
        for (let e of experiments.sorted()) {
            for (let r of e.runs) {
                runUIs.push(RunUI.create(r))
            }
        }

        return runUIs
    }

    private getFormat(): CellOptions[] {
        let format: CellOptions[] = [
            {type: 'controls', name: '', 'key': ''},
            {type: 'experiment_name', name: 'Experiment', 'key': ''},
            {type: 'comment', name: 'Comment', 'key': ''},
            {type: 'date_time', name: 'Date Time', 'key': ''},
            {type: 'info', name: 'Commit Message', 'key': 'commit_message'},
            {type: 'info', name: 'Dirty', 'key': 'is_dirty'},
            {type: 'info', name: 'Tags', 'key': 'tags'},
            {type: 'size', name: 'Size', 'key': ''},
            {type: 'size', name: 'Checkpoints', 'key': 'checkpoints_size'},
            {type: 'size', name: 'SQLite', 'key': 'sqlite_size'},
            {type: 'size', name: 'Analytics', 'key': 'analytics_size'},
            {type: 'size', name: 'Tensorboard', 'key': 'tensorboard_size'},
        ]

        format.push({type: 'step', name: 'Step', 'key': ''})

        let indicators = new Set<string>()
        for (let r of this.runs) {
            for (let k in r.values) {
                indicators.add(k)
            }
        }

        for (let k of indicators.keys()) {
            format.push({type: 'value', name: k, 'key': k})
        }

        let configs = new Set<string>()
        for (let r of this.runs) {
            for (let k in r.configs.configs) {
                configs.add(k)
            }
        }

        for (let k of configs.keys()) {
            format.push({type: 'config_computed', name: k, 'key': k})
            format.push({type: 'config_options', name: `${k} Options`, 'key': k})
        }

        return format
    }

    private createCells(format: CellOptions[]) {
        let res: Cell[] = []
        for (let opt of format) {
            res.push(CellFactory.create(opt))
        }

        return res
    }

    private async renderExperiments() {
        this.runs = RunsView.getRuns(await getExperiments())
        let promises = []
        for (let r of this.runs) {
            promises.push(r.loadConfigs())
            promises.push(r.loadValues())
        }

        await Promise.all(promises)

        this.format = this.createCells(this.getFormat())

        let views: RunView[] = []
        for (let r of this.runs) {
            views.push(new RunView(r))
        }

        $('div.header', this.runsTable, $ => {
            for (let c of this.format) {
                c.renderHeader($)
            }
        })
        for (let v of views) {
            this.runsTable.append(v.render(this.format))
        }
    }
}

export class TableHandler {
    constructor() {
        ROUTER.route('table', [this.handleTable])
    }

    handleTable = () => {
        SCREEN.setView(new RunsView())
    }
}

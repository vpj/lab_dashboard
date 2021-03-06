import * as YAML from 'yaml'
import * as PATH from 'path'
import {Run, RunCollection, RunModel, ScalarsModel} from '../../common/experiments'
import {LAB} from '../consts'
import {getDiskUsage, lstat, readdir, readFile} from '../util'
import {RunNodeJS} from "../run_nodejs";

abstract class CacheEntry<T> {
    private lastLoaded: number
    private readonly minDelay: number = 5 * 1_000 // 5 seconds
    protected readonly maxDelay: number = 2 * 60 * 60 * 1_000 // 2 hours
    private readonly exponentialFactor: number = 1.5
    private delay: number
    protected cached: T

    protected constructor() {
        this.lastLoaded = 0
        this.delay = this.minDelay
    }

    protected abstract async loadIfUpdated(original: T): Promise<T>

    async get(): Promise<T> {
        let now = (new Date()).getTime()
        if (this.cached == null || this.lastLoaded + this.delay < now) {
            let updated = await this.loadIfUpdated(this.cached)
            if (updated != null) {
                this.cached = updated
                this.delay = Math.max(this.minDelay, this.delay / this.exponentialFactor)
                // console.log("Reduced checking time to ", this.delay)
            } else {
                let delay = now - this.lastLoaded
                this.delay = Math.min(this.maxDelay, delay * this.exponentialFactor)
                // console.log("Extended checking time to ", this.delay)
            }

            this.lastLoaded = now
        }

        return this.cached
    }

    reset() {
        this.cached = null
    }
}

class RunModelCacheEntry extends CacheEntry<RunModel> {
    public readonly name: string;
    public readonly uuid: string;

    constructor(name: string, uuid: string) {
        super();
        this.name = name;
        this.uuid = uuid;
    }

    private static getMaxStep(values: ScalarsModel) {
        let maxStep = 0
        for (let value of Object.values(values)) {
            maxStep = Math.max(maxStep, value.step)
        }

        return maxStep
    }

    protected async loadIfUpdated(original?: RunModel): Promise<RunModel> {
        if (original == null) {
            return await this.watchedLoad()
        }

        let run = RunNodeJS.create(new Run(original))
        let values = await run.getValues()
        if (RunModelCacheEntry.getMaxStep(original.values) !==
            RunModelCacheEntry.getMaxStep(values)) {
            return await this.watchedLoad()
        }

        // console.log('cached', this.uuid)
        return null
    }

    private async watchedLoad(): Promise<RunModel> {
        // console.log(`Loading run ${this.name} ${this.uuid}`)
        let start = (new Date()).getTime()
        let loaded = await this.load()
        let end = (new Date()).getTime()
        if (end - start > 100) {
            console.log(`Loaded run ${this.name} ${this.uuid} in ${(end - start)} ms`)
        }

        return loaded
    }

    private async load(): Promise<RunModel> {
        let contents: string
        try {
            contents = await readFile(
                PATH.join(LAB.experiments, this.name, this.uuid, 'run.yaml'),
            )
        } catch (e) {
            console.log(`Failed to read run ${this.name} - ${this.uuid}`)
            return null
        }

        let res: RunModel = YAML.parse(contents)
        res = Run.fixRunModel(this.name, res)

        res.uuid = this.uuid
        res.total_size = await getDiskUsage(
            PATH.join(LAB.experiments, this.name, this.uuid)
        )
        res.artifacts_size = await getDiskUsage(
            PATH.join(LAB.experiments, this.name, this.uuid, 'artifacts')
        )
        res.checkpoints_size = await getDiskUsage(
            PATH.join(LAB.experiments, this.name, this.uuid, 'checkpoints')
        )
        res.tensorboard_size = await getDiskUsage(
            PATH.join(LAB.experiments, this.name, this.uuid, 'tensorboard')
        )
        res.sqlite_size = await getDiskUsage(
            PATH.join(LAB.experiments, this.name, this.uuid, 'sqlite.db')
        )
        res.analytics_size = await getDiskUsage(
            PATH.join(LAB.analytics, this.name, this.uuid)
        )

        let run = RunNodeJS.create(new Run(res))
        res.values = await run.getValues()
        res.configs = (await run.getConfigs()).configs

        return res
    }
}

interface ExperimentRunsSet {
    [name: string]: Set<string>
}


class ExperimentRunsSetCacheEntry extends CacheEntry<ExperimentRunsSet> {
    protected readonly maxDelay: number = 30 * 1_000

    constructor() {
        super()
    }

    protected async loadIfUpdated(original?: ExperimentRunsSet): Promise<ExperimentRunsSet> {
        let loaded = await ExperimentRunsSetCacheEntry.load()

        if (ExperimentRunsSetCacheEntry.isUpdated(original, loaded)) {
            let count = 0
            for (let runs of Object.values(loaded)) {
                for (let r of runs.keys()) {
                    count++
                }
            }
            console.log(`Found ${count} runs`)
            return loaded
        }

        return null
    }

    private static isUpdated(original: ExperimentRunsSet, loaded: ExperimentRunsSet): boolean {
        if (original == null) {
            return true
        }

        for (let [e, runs] of Object.entries(loaded)) {
            if (runs == null) {
                return true
            }
            if (original[e] == null) {
                return true
            }
            for (let r of runs.keys()) {
                if (!original[e].has(r)) {
                    return true
                }
            }
        }

        return false
    }

    private static async load(): Promise<ExperimentRunsSet> {
        let experiments = await readdir(LAB.experiments)
        let res: ExperimentRunsSet = {}

        for (let e of experiments) {
            let expPath = PATH.join(LAB.experiments, e)

            let stats = await lstat(expPath)
            if (!stats.isDirectory()) {
                continue
            }

            if (!e.startsWith('_') && !e.startsWith('.')) {
                let runs = await readdir(expPath)
                res[e] = new Set<string>()
                for(let r of runs) {
                    if(!r.startsWith('.')) {
                        res[e].add(r)
                    }
                }
            }
        }

        return res
    }
}

class Cache {
    experimentRunsSet: ExperimentRunsSetCacheEntry
    runs: { [uuid: string]: RunModelCacheEntry }

    constructor() {
        this.experimentRunsSet = new ExperimentRunsSetCacheEntry()
        this.runs = {}
    }

    async getRun(uuid: string): Promise<RunModel> {
        if (this.runs[uuid] == null) {
            let expSet = await this.experimentRunsSet.get()
            for (let [expName, runs] of Object.entries(expSet)) {
                if (runs.has(uuid)) {
                    if (this.runs[uuid] != null) {
                        if (this.runs[uuid].name != expName) {
                            this.runs[uuid] = new RunModelCacheEntry(expName, uuid)

                        }
                    } else {
                        this.runs[uuid] = new RunModelCacheEntry(expName, uuid)
                    }
                }
            }
        }
        return await this.runs[uuid].get()
    }

    private async getExperiment(name: string): Promise<RunModel[]> {
        let runs: RunModel[] = []

        for (let r of (await this.experimentRunsSet.get())[name].keys()) {
            runs.push(await this.getRun(r))
        }
        return runs
    }

    private async getExperimentAsync(name: string): Promise<Promise<RunModel>[]> {
        let promises: Promise<RunModel>[] = []

        for (let r of (await this.experimentRunsSet.get())[name].keys()) {
            promises.push(this.getRun(r))
        }
        return promises
    }


    async getAllAsync(): Promise<RunCollection> {
        let promises: Promise<RunModel>[] = []

        for (let e of Object.keys(await this.experimentRunsSet.get())) {
            promises = promises.concat(await this.getExperimentAsync(e))
        }
        let runs = await Promise.all(promises)

        let filteredRuns = []
        for (let r of runs) {
            if (r != null) {
                filteredRuns.push(r)
            }
        }
        return new RunCollection(filteredRuns)
    }

    async getAll(): Promise<RunCollection> {
        let runs: RunModel[] = []

        for (let e of Object.keys(await this.experimentRunsSet.get())) {
            runs = runs.concat(await this.getExperiment(e))
        }

        let filteredRuns = []
        for (let r of runs) {
            if (r != null) {
                filteredRuns.push(r)
            }
        }
        return new RunCollection(filteredRuns)
    }

    resetRun(uuid: string) {
        // console.log('resetCache', uuid)
        if (this.runs[uuid] != null) {
            delete this.runs[uuid]
        }

        this.experimentRunsSet.reset()
    }
}

const _CACHE = new Cache()

class ExperimentsFactory {
    static async load(): Promise<RunCollection> {
        let start = (new Date()).getTime()
        let all = await _CACHE.getAll()
        let end = (new Date()).getTime()
        console.log(`Loaded runs in ${(end - start)} ms`)

        return all
    }

    static cacheReset(uuid: string) {
        // console.log('reset', experimentName, runUuid)
        _CACHE.resetRun(uuid)
    }
}

export {ExperimentsFactory}

import { instant, promql, range } from '#lib/server/metrics.ts'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async () => {
  const [cpu, cpuSeries, memory, memorySeries, memoryTotal, disk, diskTotal, load, cores, uptime] =
    await Promise.all([
      instant(promql.hostCpu),
      range(promql.hostCpu),
      instant(promql.hostMemory),
      range(promql.hostMemory),
      instant(promql.hostMemoryTotal),
      instant(promql.hostDisk),
      instant(promql.hostDiskTotal),
      instant(promql.hostLoad),
      instant(promql.hostCores),
      instant(promql.hostUptime),
    ])
  return { cpu, cpuSeries, memory, memorySeries, memoryTotal, disk, diskTotal, load, cores, uptime }
}

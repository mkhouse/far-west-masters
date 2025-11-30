/* Used as an Airtable automation script to calculate cup results
passed variables are passed from the import table at the top starting with config.
raceTable1 = name of the table with results for the first race to use,
  also name of the field in the results for the combined time of the first race
raceTable2 = name of the table with results for the second race to use
    also name of the field in the results for the combined time of the second race
disc1 = discipline for the first race, from the import table
disc2 = discipline for the second race, from the import table
cupTableName = name of the table to write the results
*/

// Calculate cup results

/* **** GS calculation ****************************** */
/* 
Bernard Cup Formula for 5-year age classes (GS, triple-combined)
    BCTime = Time * ( 1 - ( HANDICAP * ( ageClassNumber - 1 ) )
    where HANDICAP = 0.025 (2.5% handicap per 5-year age class)
    and ageClassNumber = 1, 2. 3, ... 11, 12, 13
 
The GS/triple-combined handicap factor is 2.5% per 5-year age class.
The age class time adjustment factors range from 1 for 20’s (i.e., their actual time is used),
through 70% for 80’s (their handicapped time is 70% of their actual time).
 
Age Class	Age Class Factor	Adjustment Formula	Adjusted Time
1 [20..29]	1	( 1 - ( 0.025 * 0 ) )	Time
2 [30..34]	97.5%	( 1 - ( 0.025 * 1 ) )	Time * 0.975
3 [35-39]	95%	( 1 - ( 0.025 * 2 ) )	Time * 0.95
4 [40..44]	92.5%	( 1 - ( 0.025 * 3 ) )	Time * 0.925
5 [45..49]	90%	( 1 - ( 0.025 * 4 ) )	Time * 0.90
6 [50..54]	87.5%	( 1 - ( 0.025 * 5 ) )	Time * 0.875
7 [55..59]	85%	( 1 - ( 0.025 * 6 ) )	Time * 0.85
8 [60..64]	82.5%	( 1 - ( 0.025 * 7 ) )	Time * 0.825
9 [65..69]	80%	( 1 - ( 0.025 * 8 ) )	Time * 0.80
10 [70..74]	77.5%	( 1 - ( 0.025 * 9 ) )	Time * 0.775
11 [75..79]	75%	( 1 - ( 0.025 * 10 )	Time * 0.75
12 [80..84]	72.5%	( 1 - ( 0.025 * 11 )	Time * 0.725
13 [85..89]	70%	( 1 - ( 0.025 * 12 )	Time * 0.70
*/

/* **** SL calculation ****************************** */
/* 
Bernard Cup Formula for 5-year age classes (SL)
    BCTime = Time * ( 1 - ( HANDICAP * ( ageClassNumber - 1 ) )
    where HANDICAP = 0.03 (3% handicap per 5-year age class)
    and ageClassNumber = 1, 2. 3, ... 11, 12, 13

The SL handicap factor is 3% per 5-year age class.
The age class time adjustment factors range from 1 for 20’s (i.e., their actual time is used),
through 64% for 80’s (their handicapped time is 64% of their actual time).
 
Age Class	Age Class Factor	Adjustment Formula	Adjusted Time
1 [20..29]	1	( 1 - ( 0.03 * 0 ) )	Time
2 [30..34]	97%	( 1 - ( 0.03 * 1 ) )	Time * 0.97
3 [35-39]	94%	( 1 - ( 0.03 * 2 ) )	Time * 0.94
4 [40..44]	91%	( 1 - ( 0.03 * 3 ) )	Time * 0.91
5 [45..49]	88%	( 1 - ( 0.03 * 4 ) )	Time * 0.88
6 [50..54]	85%	( 1 - ( 0.03 * 5 ) )	Time * 0.85
7 [55..59]	82%	( 1 - ( 0.03 * 6 ) )	Time * 0.82
8 [60..64]	79%	( 1 - ( 0.03 * 7 ) )	Time * 0.79
9 [65..69]	76%	( 1 - ( 0.03 * 8 ) )	Time * 0.76
10 [70..74]	73%	( 1 - ( 0.03 * 9 ) )	Time * 0.73
11 [75..79]	70%	( 1 - ( 0.03 * 10 )	Time * 0.70
12 [80..84]	67%	( 1 - ( 0.03 * 11 )	Time * 0.67
13 [85..89]	64%	( 1 - ( 0.03* 12 )	Time * 0.64
*/

const config = input.config()
const raceTable1 = config.raceTable1.toString().trim()
const raceTable2 = config.raceTable2.toString().trim()
const disc1 = config.disc1.toString().trim()
const disc2 = config.disc2.toString().trim()
const cupTableName = config.cupTableName.toString().trim()

const now = new Date()
const year = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1

const ageClasses = [
  { class: 1, minAge: 18, maxAge: 29 },
  { class: 2, minAge: 30, maxAge: 34 },
  { class: 3, minAge: 35, maxAge: 39 },
  { class: 4, minAge: 40, maxAge: 44 },
  { class: 5, minAge: 45, maxAge: 49 },
  { class: 6, minAge: 50, maxAge: 54 },
  { class: 7, minAge: 55, maxAge: 59 },
  { class: 8, minAge: 60, maxAge: 64 },
  { class: 9, minAge: 65, maxAge: 69 },
  { class: 10, minAge: 70, maxAge: 74 },
  { class: 11, minAge: 75, maxAge: 79 },
  { class: 12, minAge: 80, maxAge: 84 },
  { class: 13, minAge: 85, maxAge: 89 },
  { class: 14, minAge: 90, maxAge: 110 },
]

const toDuration = (totalSeconds) => {
  const mins = Math.floor(totalSeconds / 60)
  const secs = (totalSeconds % 60).toFixed(2)
  return mins > 0 ? `${mins}:${secs.padStart(5, '0')}` : secs
}

const memberSync = await base
  .getTable('Sync from member list for YOB')
  .selectRecordsAsync({
    fields: ['Results name', 'USSSA', 'YOB', 'Gender'],
  })

const raceResults1 = await base.getTable(raceTable1).selectRecordsAsync({
  fields: ['Racer', 'Combined', 'Class rank'],
})

const raceResults2 = await base.getTable(raceTable2).selectRecordsAsync({
  fields: ['Racer', 'Combined', 'Class rank'],
})
// Build lookup map for race2
const race2ByRacer = new Map(
  raceResults2.records.map((r) => [r.getCellValue('Racer'), r])
)

// combine records with results in race 1 (may or may not have race 2 result)
let combinedResults = raceResults1.records.flatMap((result) => {
  const result2 = race2ByRacer.get(result.getCellValue('Racer'))
  const [lastname, firstname] = result
    .getCellValueAsString('Racer')
    .toLowerCase()
    .split(',')

  const hasD =
    result.getCellValueAsString('Combined').includes('D') ||
    result2?.getCellValueAsString('Combined').includes('D')

  const incomplete = result2 === undefined || hasD

  return {
    racer: result.getCellValue('Racer'),
    result1: result.getCellValue('Combined'),
    result1Rank: result.getCellValue('Class rank'),
    result2: result2?.getCellValue('Combined') ?? null,
    result2Rank: result2?.getCellValue('Class rank') ?? null,
    firstname: firstname.trim(),
    lastname: lastname.trim(),
    ...(incomplete ? { position: '999' } : {}),
  }
})

// build a map of race 2 results
const racersInCombined = new Set(combinedResults.map((r) => r.racer))

// add in racers who only did race 2
const onlyInRace2 = raceResults2.records.flatMap((result) => {
  if (racersInCombined.has(result.getCellValue('Racer'))) return []

  const [lastname, firstname] = result
    .getCellValueAsString('Racer')
    .toLowerCase()
    .split(',')

  return {
    racer: result.getCellValue('Racer'),
    result1: null,
    result1Rank: null,
    result2: result.getCellValue('Combined'),
    result2Rank: result.getCellValue('Class rank'),
    firstname: firstname.trim(),
    lastname: lastname.trim(),
    position: '999',
  }
})

combinedResults = [...combinedResults, ...onlyInRace2]

// add YOB and gender from the members table to results
let resultsForCalc = combinedResults.flatMap((combo) => {
  const data = memberSync.records.find(
    (member) =>
      member.getCellValueAsString('Results name').toLowerCase().includes(combo.lastname) &&
      member.getCellValueAsString('Results name').toLowerCase().includes(combo.firstname)
  )
  if (data === undefined) {
    console.log('no match ', combo.racer)
    return []
  }
  // if it's jan-june, get previous year. if it's july - dec, get current year
  const age = year - data.getCellValue('YOB')
  const ageClass = ageClasses.find((c) => age >= c.minAge && age <= c.maxAge)
  const classNumber = ageClass != null ? parseInt(ageClass.class) : null

  return {
    ...combo,
    yob: data.getCellValue('YOB'),
    gender: data.getCellValueAsString('Gender'),
    raceClass: classNumber,
  }
})

// figure out if any of the racers don't have YOB
let needsYOB = resultsForCalc.filter((noyob) => noyob.yob === null)

// error out if any racers need YOB
if (needsYOB.length > 0) {
  console.log('needsYOB', needsYOB)
  throw new Error('Racers need YOB, see needsYOB array in log')
}

// do the handiap calculations and add them to each racer
// but skip the racers who already have the 999 position and give them
// a combined time of Infinity so the sort works at the end
const resultsWithHcp = resultsForCalc.map((racer) => {
  if (racer.position === '999') {
    return {
      ...racer,
      dhcp1: null,
      dhcp2: null,
      dcombined: null,
      hcp1: null,
      hcp2: null,
      combined: Infinity,
      rawCombined: null
    }
  }

  const time1 = racer.result1.includes(':')
    ? Number(racer.result1.split(':')[0]) * 60 +
      Number(racer.result1.split(':')[1])
    : Number(racer.result1)

  const time2 = racer.result2.includes(':')
    ? Number(racer.result2.split(':')[0]) * 60 +
      Number(racer.result2.split(':')[1])
    : Number(racer.result2)

  const factor1 = disc1 === 'SL' ? 0.03 : 0.025
  const factor2 = disc2 === 'SL' ? 0.03 : 0.025

  const hcp1 = time1 * (1 - factor1 * (racer.raceClass - 1))
  const hcp2 = time2 * (1 - factor2 * (racer.raceClass - 1))
  const combined = hcp1 + hcp2

  const rawCombinedSeconds = time1 + time2

  return {
    ...racer,
    dhcp1: toDuration(hcp1),
    dhcp2: toDuration(hcp2),
    dcombined: toDuration(combined),
    hcp1: hcp1,
    hcp2: hcp2,
    combined: combined,
    rawCombined: toDuration(rawCombinedSeconds)
  }
})

// sort the array into geder order and then combined time within gender
const genderOrder = { F: 1, M: 2 }

resultsWithHcp.sort((a, b) => {
  if (a.gender !== b.gender) {
    return genderOrder[a.gender] - genderOrder[b.gender]
  }
  return a.combined - b.combined
})

// add in the position for men and women
const positionCounters = {}

resultsWithHcp.forEach((racer) => {
  if (racer.position !== '999') {
    positionCounters[racer.gender] = (positionCounters[racer.gender] || 0) + 1
    racer.position = positionCounters[racer.gender]
  }
})

console.log('resultsWithHcp', resultsWithHcp)

const table = base.getTable(cupTableName)

const genderMap = { 'F': 'Women', 'M': 'Men' }

// Map the final array to Airtable's record format to use for record creation
const recordsToCreate = resultsWithHcp.map(racer => {
  const race1Started = racer.result1 !== null
  const race2Started = racer.result2 !== null
  const race1Finished = race1Started && !racer.result1.includes('D')
  const race2Finished = race2Started && !racer.result2.includes('D')
  const combinedDuration = racer.combined !== Infinity ? toDuration(racer.combined) : null
  const started = (race1Started ? 1 : 0) + (race2Started ? 1 : 0)
  const finished = (race1Finished ? 1 : 0) + (race2Finished ? 1 : 0)

  const result1Display = racer.result1 !== null 
  ? racer.result1.includes('D')
    ? racer.result1
    : `${racer.result1} (${racer.result1Rank})`
  : null

  const result2Display = racer.result2 !== null 
  ? racer.result2.includes('D')
    ? racer.result2
    : `${racer.result2} (${racer.result2Rank})`
  : null

  return {
    fields: {
      'Competitor': racer.racer,
      'Gender': {name: genderMap[racer.gender]},
      'Sort position': racer.position.toString(),
      'Start': started.toString(),
      'Finish': finished.toString(),
      [raceTable1]:result1Display,
      [raceTable2]: result2Display,
      'No handicap time': racer.rawCombined,
      'Handicap time': combinedDuration,
      'Position': racer.position !== '999' ? racer.position.toString() : '-',
      ...(racer.position !== '999' ? { 
        'Time': `${combinedDuration} [${racer.rawCombined}]`
      } : {})
      }
  }
})
// Create in batches of 50
const batchSize = 50
for (let i = 0; i < recordsToCreate.length; i += batchSize) {
  const batch = recordsToCreate.slice(i, i + batchSize)
  await table.createRecordsAsync(batch)
}

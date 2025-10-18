/*
Imports results from Import table when ready to import is checked.
Race Table to use as target of import is determined from a single 
field entry in the Import table.
Racer record is created for overall standings if one does not exist.
If racer record exists, the new result is linked to the racer record.
*/

const config = input.config()
let raceTable = config.raceTable.toString()
const raceColumn = config.raceColumn

const importTable = await base.getTable('Import')
  .selectRecordsAsync({
    fields: [
      'Competitor',
      'First run',
      'Second run',
      'Combined',
      'Race points',
    ]
  })

const racersTable = await base.getTable('Overall Standings')
  .selectRecordsAsync({
    fields: [
      'Name',
      'Class'      
    ]
  })

const raceRecordsToUpdate = []

// for each record in the import table
const handleImport = importTable.records.map((id) => {
  // populate import class column
  const classStart = id.getCellValueAsString('Competitor').substr(id.getCellValueAsString('Competitor').indexOf('(')+1, id.getCellValueAsString('Competitor').length - id.getCellValueAsString('Competitor').indexOf('(')-2)
  // populate import DNF / DNS columns
  const racerName = id.getCellValueAsString('Competitor')
    .substring(0, id.getCellValueAsString('Competitor').indexOf('(')-1)
  const oneDNF = 
    id.getCellValueAsString('First run') === 'DNF'|| id.getCellValueAsString('First run') === 'DNS' || id.getCellValueAsString('First run') === 'DSQ'
    ? id.getCellValueAsString('First run')
    : ''
    console.log('oneDNF', oneDNF)
  const twoDNF =
    id.getCellValueAsString('Second run') === 'DNF'|| id.getCellValueAsString('Second run') === 'DNS' || id.getCellValueAsString('Second run') === 'DSQ'
    ? id.getCellValueAsString('Second run')
    : ''
  const resultOne = 
    oneDNF.length > 0
    ? ''
    : id.getCellValueAsString('First run')
  const resultTwo = 
    twoDNF.length > 0
    ? ''
    : id.getCellValueAsString('Second run')
  const combined =
    oneDNF.length > 0 || twoDNF.length > 0
    ? null
    : id.getCellValueAsString('Combined')
  // look up name and class in racersTable so it can be linked to race record
  const inRacersTable = racersTable.records.find(racer => (racerName == racer.getCellValueAsString('Name')) && (classStart == racer.getCellValueAsString('Class')))
  return inRacersTable
    // if found, add the racersTableId
    ? { id: id, racerName: racerName, racerClass: classStart, combined: combined, racePoints: id.getCellValue('Race points')+0, oneDNF: oneDNF, twoDNF: twoDNF, racersTableId: inRacersTable.id, runOne: resultOne, runTwo: resultTwo}
    // if empty, racersTableID is null
    : { id: id.id, racerName: racerName, racerClass: classStart, combined: combined, racePoints: id.getCellValue('Race points')+0, oneDNF: oneDNF, twoDNF: twoDNF, racersTableId: null, runOne: resultOne, runTwo: resultTwo}
})

console.log(handleImport)



// add to list to create race results
let createResult = []
for (let result of handleImport) {
  //create racer record if needed
  if(result.racersTableId == null){
    let newRacerRecord = await base.getTable('Overall Standings').createRecordAsync({
      'Name': result.racerName,
      'Class': {name: result.racerClass}
    })
    // add to import queue with new racer record
    createResult.push(
      {fields:{
        'Competitor': result.racerName,
        'First run time': result.runOne,
        'Second run time': result.runTwo,
        'First run DNF / DSQ': result.oneDNF,
        'Second run DNF / DSQ': result.twoDNF,
        'Class': {name: result.racerClass},
        '2024 - 2025 Racers': [{id: newRacerRecord}],
        'Race points': result.racePoints,
        'Final': result.combined
      }
    })
  } else {
    // add to import queue with existing racer record
    createResult.push(
      {fields:{ 
        'Competitor': result.racerName,
        'First run time': result.runOne,
        'Second run time': result.runTwo,
        'First run DNF / DSQ': result.oneDNF,
        'Second run DNF / DSQ': result.twoDNF,
        'Class': {name: result.racerClass},
        '2024 - 2025 Racers': [{id: result.racersTableId}],
        'Race points': result.racePoints,
        'Final': result.combined
      }
    })
  }
}



// create race records in batches
while (createResult.length > 0) {
    await base.getTable(raceTable).createRecordsAsync(createResult.slice(0, 50))
    createResult = createResult.slice(50)
}

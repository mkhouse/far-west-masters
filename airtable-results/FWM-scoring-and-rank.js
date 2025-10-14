// Calculate FWM scoring & class rank
const config = input.config()
const raceTable = config.raceTable.toString()
const raceResultsTable = await base.getTable(raceTable)
  .selectRecordsAsync({
    fields: [
      'Class rank',
      'Competitor',
      'Class',
      'Race points',
      'Final'
    ],
    sorts: [
      {field: 'Class', direction: 'desc'},
      {field: 'Final', direction: 'asc'}
    ]
})

const classListTable = await base.getTable('Class list')
  .selectRecordsAsync({
    fields: [
      'Name'
    ]
  })

//for each of the items in the Class List Table
// find the results in that class
// the list will already be sorted by rank because we sorted the results by combined time when we got the table
// then create an array of those results and return them to createRanks
const createRanks =
    raceResultsTable.recordIds.length > 0
    ? classListTable.records.map(raceClass => {
        const similar = raceResultsTable.records.filter(sim => sim.getCellValueAsString('Class') === raceClass.name)
        //console.log('similar', similar)
        let item = []
        if (similar.length > 0) {
          similar.forEach (result => {
            //console.log('result', result, result.id, similar.indexOf(result)+1)
            if (result.getCellValueAsString('Final') != 0) {
            item.push({id: result.id, fields:{'Class rank': item.length+1}})
            }
          })
        }
        //console.log(item[0])
        if (item[0] != undefined) {
          return item
        }
        return false
    })
    : []

// create an array of ranks without the false values created when no one raced in a class
const cleanedRanks = createRanks.filter(Boolean)
// flatten the array so we can update in Airtable
let ranks = cleanedRanks.flatMap(obj => obj.valueOf())
console.log(ranks)

// write the ranks to the table with the results for this race

while (ranks.length > 0) {
    await base.getTable(raceTable).updateRecordsAsync(ranks.slice(0, 50))
    ranks = ranks.slice(50)
}

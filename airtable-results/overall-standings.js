// after each race is imported, recalculate and update overall standings
const overallStandingsTable = await base.getTable('Overall Standings')
  .selectRecordsAsync({
    fields: [
      'Name',
      'Class',
      'Class rank',
      'Class points'
    ],
    sorts: [
      {field: 'Class', direction: 'desc'},
      {field: 'Class points', direction: 'desc'}
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
    // as long as the table has some standings
    overallStandingsTable.recordIds.length > 0
    ? classListTable.records.map(raceClass => {
        // create an array of all of the people in the class
        const similar = overallStandingsTable.records.filter(sim => sim.getCellValueAsString('Class') === raceClass.name)
        let item = []
        // if there are people in the class
        if (similar.length > 0) {
          let lastClass = ''
          let newRank = 0
          let lastRank = 0
          let lastPoints = 0
          similar.forEach (result => {
              // if last points = current result points, and it's the same class, it's a tie, so use the same rank
              // and update the rank of the previous item to have a (t)
            if (lastPoints == result.getCellValue('Class points') && lastClass == result.getCellValueAsString('Class')) {
              newRank = lastRank
              // if the last item in the item array is the same rank & doesn't already have a t
              // update the rank of the previous item to have a (t) and also push this item with a t
              if (JSON.stringify(item[item.length-1].fields).includes(lastRank) && 
                !JSON.stringify(item[item.length-1].fields).includes('t')) {
                let oldID = item[item.length-1].id
                item[item.length-1] = {id: oldID, fields:{'Class rank': newRank.toString() + '(t)'}}
                item.push({id: result.id, fields:{'Class rank': newRank.toString() + '(t)'}})
            } else {
              item.push({id: result.id, fields:{'Class rank': newRank.toString() + '(t)'}})
            }
            } else { // otherwise, just increment normally
              newRank = item.length+1
              lastRank = newRank
              item.push({id: result.id, fields:{'Class rank': newRank.toString()}})
            }
            // update last points and last class
            lastPoints = result.getCellValue('Class points')
            lastClass = result.getCellValueAsString('Class')

          })
        }
        // if the item array has values, return it
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

// write the ranks to the Airable table with the results for this race
while (ranks.length > 0) {
    await base.getTable('Overall Standings').updateRecordsAsync(ranks.slice(0, 50))
    ranks = ranks.slice(50)
}

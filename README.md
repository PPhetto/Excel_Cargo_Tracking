# Excel Group Cargo Tracker

For a staff-only server pilot, start with [IT-PILOT.md](IT-PILOT.md).

1. Extract the ZIP on your Windows PC and open **Start Tracker.cmd**.
2. Open [the local tracker](http://127.0.0.1:4178/) in your browser.
3. Enter one AWB per line with the shipper name after it if available, or paste the **AWB** and **Shipper** columns from Excel. Select **Track all**.

Keep the launcher window open while you use the tracker. Microsoft Edge runs the carrier checks in the background. The dashboard shows results as they arrive.

If a batch is already running in another tab, the tracker queues your batch and starts it automatically when the previous one finishes.

| Airline | AWB prefix | Number sent to the airline |
|---|---|---|
| Air India Cargo | 098 | All 11 digits |
| Finnair Cargo | 105 | All 11 digits |
| JAL Cargo | 131 | Last 8 digits |
| Qatar Airways Cargo | 157 | Last 8 digits |
| Emirates SkyCargo | 176 | All 11 digits |
| Korean Air Cargo | 180 | Last 8 digits |
| ANA Cargo | 205 | Last 8 digits |
| Thai Airways Cargo | 217 | Last 8 digits |
| Turkish Cargo | 235 | Last 8 digits |
| China Airlines Cargo | 297 | All 11 digits |
| Singapore Airlines Cargo | 618 | All 11 digits |

The dashboard accepts spaces and dashes in pasted AWBs. It takes the destination airport from the carrier's shipment record. Status dates are displayed as published by the airline. A confirmed booking or scheduled flight is shown as such. The dashboard saves the last verified result for each AWB in this browser and shows it alongside a failed check.

The **Shipper** column displays the name you pasted for each AWB. It stays blank when you enter only an AWB. The tracker sends only the AWB to the airline.

**Cargo detail** shows the shipment's total pieces, weight and cubic metres (CBM) where published in the carrier's shipment summary.

**Track shipment detail** opens the airline's website in a new tab. TK links open the AWB search directly. AY and EK links open the exact order when ETK has its verified detail address. When a carrier's tracking form opens, enter the number shown beneath the link.

For JAL Cargo, enter 131 in the prefix field and the eight-digit serial shown in ETK in the next field. If JAL blocks the automatic check, ETK shows **Manual check required**.

For Korean Air Cargo, JAL Cargo, China Airlines Cargo and ANA Cargo, **View quick image** opens a capture from the same successful check when the shipment page is available. The image is kept in the current tab for the current batch.

**Pieces by flight** shows the carrier's total pieces, confirmed departures, and published bookings when available. The number that departed the origin excludes connecting flights. A booking shown in the event history is labeled **Booking shown**. If the carrier leaves a quantity blank or the departure rows could overlap, the dashboard leaves the corresponding count blank.

For Singapore Airlines, the tracker checks the booking status of each flight leg. If the summary says **Booked** and all listed bookings are cancelled, the dashboard shows **Booking cancelled** unless the airline also reports actual cargo movement. Cancelled bookings appear under **Pieces by flight**.

Singapore Airlines results also show how many pieces arrived at the final airport when the carrier provides a piece count for each arrival flight. Warehouse and pickup entries are excluded from the arrival sum.

Air India Cargo, China Airlines Cargo and ANA Cargo statuses and event timestamps come from the AWB Activity Timeline in **Activity View**.

Turkish Cargo status comes from **Status History**. Confirmed reservations appear under **Pieces by flight**. If Turkish Cargo requires human verification, select **Track shipment detail** and complete the check on the airline's website.

Emirates SkyCargo uses the active order when the same AWB also has cancelled orders. If all matching orders are cancelled, ETK shows **Booking cancelled**.

## Setup if the launcher reports missing components

The Windows launcher checks for the ChatGPT desktop runtime that includes Node.js and Playwright. If these components are unavailable, install Node.js 20 or later, then run the following in the extracted folder. The Windows dashboard uses your installed Microsoft Edge.

    npm.cmd install
    npm.cmd start

For command-line use, run the following from the same folder. The result is JSON and includes the recorded carrier milestones.

    node src/track.cjs --channel msedge <your-awb>

This version checks a batch when you select **Track all**. Recurring checks require a separate schedule.

# Race Bib Logger v19.3.6

## Director Mode cleanup

The following retired command-centre widgets are no longer injected into Director Mode or shown in Customize:

- Missing Runner Workflow
- Medical Capacity Board
- Sweep & Transport Tracking
- Weather Risk
- Checkpoint Supply Status
- Shift Handover
- Post-Race Command Report

Their Director-side CommandOps polling and periodic synchronization loop are also disabled. Existing spreadsheet data is not deleted.

## Unknown runner confirmation

- Runner-not-found confirmation is now a compact card centered on screen.
- The BIB is shown prominently with only **Cancel** and **Log BIB** actions.
- No structured-reason selector is shown or required.
- Approved entries are still automatically marked with `UNKNOWN_NOT_IN_SETUP` and `unknown-bib` for reconciliation.

## Quick Entry remark keyboard

- Tapping the Quick Entry remark field immediately switches to the remark target and opens the device keyboard.
- This works while the large `123` keypad is active; users no longer need to press ABC first.
- BIB and remark targeting, character limits, synchronization, and logging behavior remain unchanged.

## Compatibility

- No Racelog column migration is required.
- The service-worker cache is rotated to v19.3.6 so installed PWAs receive the new UI and scripts.

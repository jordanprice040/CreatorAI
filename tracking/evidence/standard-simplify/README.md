# Standard mode simplification (November 22, 2026)

Jordan's request: severely reduce text and large text blocks in Standard, add collapsible
sections where long text remains, and list Library in Standard.

Measured with `measure.mjs` (Playwright, 1440 px, dark theme, Standard view) on a throwaway
studio (`tracking/evidence/p1-build-retry/dev-double.mjs`, ports 5183/4330/4340, a throwaway
PostgreSQL database, seeded with `seed-selection`, `seed-research`, `seed-discovery`,
`seed-lineage`). "Words" is every visible word in the page's main area, data included.
"Long-block words" counts only blocks of running text over 160 characters (explanations).
Before = main `1874704`; after = this branch. Advanced was not shortened (13,227 words on
every tab after, against 12,736 in Standard before; Advanced lists more tabs and fields).

Totals: words 12,736 → 8,427 (−34%); long-block words 3,993 → 518 (−87%).
Autopilot page 4,180 px → 1,213 px tall; Settings 4,219 px → 1,548 px.

| Tab                    | Words before | after | Long-block words before | after |
| ---------------------- | ------------ | ----- | ----------------------- | ----- |
| chat/conversations     | 159          | 94    | 78                      | 0     |
| projects/path          | 217          | 113   | 121                     | 0     |
| projects/discover      | 283          | 242   | 103                     | 48    |
| projects/decide        | 1637         | 1296  | 537                     | 264   |
| projects/proposals     | 139          | 108   | 43                      | 0     |
| projects/specs         | 258          | 219   | 79                      | 30    |
| projects/build         | 209          | 172   | 50                      | 0     |
| projects/try           | 76           | 49    | 33                      | 0     |
| projects/sell          | 472          | 350   | 154                     | 0     |
| projects/campaigns     | 112          | 112   | 0                       | 0     |
| projects/maintain      | 152          | 133   | 28                      | 0     |
| autopilot/run          | 1904         | 202   | 999                     | 0     |
| autopilot/compare      | 71           | 71    | 32                      | 32    |
| sources/claims         | 416          | 363   | 90                      | 26    |
| sources/library        | 656          | 656   | 0                       | 0     |
| sources/files          | 113          | 81    | 38                      | 0     |
| sources/search         | 126          | 88    | 43                      | 0     |
| monitor/overview       | 358          | 336   | 33                      | 0     |
| monitor/approvals      | 361          | 338   | 31                      | 0     |
| monitor/notifications  | 162          | 142   | 28                      | 0     |
| monitor/runs           | 635          | 582   | 59                      | 0     |
| monitor/activity       | 740          | 740   | 0                       | 0     |
| monitor/budgets        | 650          | 621   | 84                      | 39    |
| monitor/workers        | 190          | 153   | 46                      | 0     |
| monitor/storage        | 324          | 234   | 97                      | 0     |
| connections/models     | 215          | 163   | 113                     | 36    |
| connections/github     | 120          | 83    | 46                      | 0     |
| connections/devices    | 190          | 108   | 136                     | 43    |
| settings/general       | 1346         | 235   | 782                     | 0     |
| settings/notifications | 387          | 285   | 110                     | 0     |
| settings/study         | 58           | 58    | 0                       | 0     |

The `*-before-after.png` images put both versions side by side at half size. Library is listed
in Standard after the change (its tab row before had only Sources and claims, Files and Search).

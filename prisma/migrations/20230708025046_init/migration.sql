-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Event" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "host_id" INTEGER NOT NULL,
    "host_token" TEXT NOT NULL DEFAULT '',
    "host_refresh_token" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "Event_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Event" ("host_id", "host_token", "id") SELECT "host_id", "host_token", "id" FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;

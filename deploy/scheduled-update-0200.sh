#!/bin/bash
set -e
echo "[SCHEDULED-UPDATE] $(date) - Starting 02:00 automatic update deployment..." >> /var/log/scheduled-update.log
if [ -f /opt/update-bundle-20261015-0200.tar.gz ]; then
    /opt/hot-swap.sh /opt/update-bundle-20261015-0200.tar.gz >> /var/log/scheduled-update.log 2>&1
    echo "[SCHEDULED-UPDATE] $(date) - Hot swap completed successfully!" >> /var/log/scheduled-update.log
else
    echo "[SCHEDULED-UPDATE] $(date) - Error: Bundle /opt/update-bundle-20261015-0200.tar.gz not found!" >> /var/log/scheduled-update.log
fi

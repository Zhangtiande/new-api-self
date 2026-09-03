package livemon

import "time"

// SweepInterval is how often leaked entries are reclaimed. Snapshots are built
// on demand rather than cached: Take only holds a read lock and costs
// microseconds at realistic in-flight counts, so a cache would add staleness
// without buying anything.
var SweepInterval = 30 * time.Second

// Init starts the background reclaim loop. Safe to call once at startup.
func Init(onSweep func(removed int)) {
	go func() {
		ticker := time.NewTicker(SweepInterval)
		defer ticker.Stop()
		for range ticker.C {
			if removed := sweep(time.Now()); removed > 0 && onSweep != nil {
				onSweep(removed)
			}
		}
	}()
}

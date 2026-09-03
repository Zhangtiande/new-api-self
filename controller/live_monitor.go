package controller

import (
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/pkg/enginemon"
	"github.com/QuantumNous/new-api/pkg/livemon"

	"github.com/gin-gonic/gin"
)

// channelLiveView joins what the gateway knows about a channel with what the
// engine behind it reports. The gap between the two is the point of the whole
// panel: gateway-heavy means requests are stuck before the GPU, engine-heavy
// queueing means the GPU itself is the bottleneck.
type channelLiveView struct {
	ChannelID   int    `json:"channel_id"`
	ChannelName string `json:"channel_name"`

	GatewayInFlight   int `json:"gateway_in_flight"`
	GatewayPrefilling int `json:"gateway_prefilling"`

	Engine *enginemon.EngineStats `json:"engine,omitempty"`
	// Gap is gateway in-flight minus what the engine admits to holding. A
	// persistently positive gap points at the network, the gateway, or retries
	// rather than at GPU saturation.
	Gap       int  `json:"gap"`
	HasEngine bool `json:"has_engine"`
}

// GetLiveStatus serves the real-time status panel. It reads memory only: no
// database query, no Redis call, nothing that scales with the polling rate.
func GetLiveStatus(c *gin.Context) {
	now := time.Now()
	gateway := livemon.Take(now)
	engines := enginemon.Snapshot(now)

	byChannel := make(map[int]*channelLiveView, len(gateway.Channels)+len(engines))
	for _, ch := range gateway.Channels {
		byChannel[ch.ChannelID] = &channelLiveView{
			ChannelID:         ch.ChannelID,
			GatewayInFlight:   ch.InFlight,
			GatewayPrefilling: ch.Prefilling,
		}
	}
	for i := range engines {
		e := engines[i]
		view, ok := byChannel[e.ChannelID]
		if !ok {
			view = &channelLiveView{ChannelID: e.ChannelID}
			byChannel[e.ChannelID] = view
		}
		view.ChannelName = e.ChannelName
		view.Engine = &e
		view.HasEngine = true
		if e.Fresh {
			view.Gap = view.GatewayInFlight - int(e.RunningReqs+e.QueuedReqs)
		}
	}

	channels := make([]channelLiveView, 0, len(byChannel))
	for _, v := range byChannel {
		channels = append(channels, *v)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"ts":              gateway.Ts,
			"total_in_flight": gateway.TotalInFlight,
			"models":          gateway.Models,
			"channels":        channels,
			"requests":        gateway.Requests,
			"truncated":       gateway.Truncated,
		},
	})
}

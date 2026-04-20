// Package domain contains the entities, value objects and repository interfaces
// for the podcast bounded context. No external framework imports here.
//
// Bible §3.9: podcasts are short audio episodes (5-15 minutes) attached to a
// section. Users listen, progress is tracked server-side, and completion
// triggers both a LOCAL domain event (for in-process consumers) and a shared
// XPGained event that season/profile domains consume transparently.
package domain

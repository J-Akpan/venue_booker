import { Request, Response } from "express"
import { audit } from "../audit"
import { pageMeta, PageQuery } from "../../shared/pagination"
import * as venues from "./venue.service"
import { env } from "../../config/env"

// Public catalogue responses may be cached by browsers and a CDN. `stale-while-revalidate`
// keeps the page fast while the cache refreshes in the background.
const publicCache = (res: Response) => res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60")

export const list = async (req: Request, res: Response) => {
    const filters = req.query as unknown as venues.VenueFilters
    const { rows, total } = await venues.listVenues(filters)
    publicCache(res).json({ data: rows, meta: pageMeta(filters, total) })
}

export const get = async (req: Request, res: Response) => {
    publicCache(res).json({ venue: await venues.getVenue(String(req.params.venueId)) })
}

export const mine = async (req: Request, res: Response) => {
    const page = req.query as unknown as PageQuery
    const { rows, total } = await venues.listOwnerVenues(req.user!.userId, page)
    res.json({ data: rows, meta: pageMeta(page, total) })
}

export const create = async (req: Request, res: Response) => {
    const venue = await venues.createVenue(req.user!.userId, req.body)
    await audit(req, { action: "venue.create", entity: "venue", entityId: venue.venueId })
    res.status(201).location(`/api/v1/venues/${venue.venueId}`).json({ venue })
}

export const update = async (req: Request, res: Response) => {
    const venueId = String(req.params.venueId)
    const venue = await venues.updateVenue(venueId, req.user!, req.body)
    await audit(req, { action: "venue.update", entity: "venue", entityId: venueId, metadata: { fields: Object.keys(req.body) } })
    res.json({ venue })
}

export const confirmAvailability = async (req: Request, res: Response) => {
    const venueId = String(req.params.venueId)
    const venue = await venues.confirmVenueAvailability(venueId, req.user!)
    await audit(req, { action: "venue.availability_confirm", entity: "venue", entityId: venueId })
    res.json({ venue })
}

export const rotateCalendarToken = async (req: Request, res: Response) => {
    const result = await venues.rotateVenueCalendarToken(String(req.params.venueId), req.user!)
    await audit(req, { action: "venue.calendar_token.rotate", entity: "venue", entityId: result.venueId })
    res.set("Cache-Control", "no-store").json({ calendarUrl: `${env.publicBaseUrl}/api/v1/bookings/calendar/${result.venueId}.ics?token=${encodeURIComponent(result.token)}` })
}

export const imageUploadSignature = async (req: Request, res: Response) => {
    const result = await venues.createVenueImageUploadSignature(String(req.params.venueId), req.user!)
    await audit(req, { action: "venue.image_upload_signature", entity: "venue", entityId: String(req.params.venueId) })
    res.set("Cache-Control", "no-store").json(result)
}

export const setVerification = async (req: Request, res: Response) => {
    const venueId = String(req.params.venueId)
    const venue = await venues.setVenueVerification(venueId, req.user!, req.body.verified)
    await audit(req, { action: req.body.verified ? "venue.verify" : "venue.unverify", entity: "venue", entityId: venueId })
    res.json({ venue })
}

export const remove = async (req: Request, res: Response) => {
    const venueId = String(req.params.venueId)
    await venues.deleteVenue(venueId, req.user!)
    await audit(req, { action: "venue.delete", entity: "venue", entityId: venueId })
    res.status(204).end()
}

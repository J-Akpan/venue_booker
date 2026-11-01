import { Op, Order, WhereOptions } from "sequelize"
import { cached, invalidateNamespace } from "../../shared/cache"
import { forbidden, notFound } from "../../shared/errors"
import { publish } from "../../shared/events"
import { PageQuery, toOffset } from "../../shared/pagination"
import { isStaff, type AuthUser } from "../../shared/middleware/auth"
import { Venue } from "./venue.model"

const CACHE_NS = "venues"
const CACHE_TTL_SECONDS = 60

export interface VenueFilters extends PageQuery {
    q?: string
    location?: string
    minCapacity?: number
    maxPrice?: number
    eventType?: string
    amenities?: string[]
    verifiedOnly?: boolean
    sort: "newest" | "price_asc" | "price_desc" | "capacity_desc" | "verified_newest"
}

const SORTS: Record<VenueFilters["sort"], Order> = {
    newest: [["createdAt", "DESC"]],
    price_asc: [["pricePerHour", "ASC"]],
    price_desc: [["pricePerHour", "DESC"]],
    capacity_desc: [["capacity", "DESC"]],
    verified_newest: [["isVerified", "DESC"], ["createdAt", "DESC"]],
}

// Escape LIKE wildcards so user input is matched literally.
const like = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`

const present = (v: Venue) => ({
    ...v.toJSON(),
    pricePerHour: Number(v.pricePerHour),
    cleaningFee: Number(v.cleaningFee),
    refundableDeposit: Number(v.refundableDeposit),
    overtimePricePerHour: Number(v.overtimePricePerHour),
})

export const listVenues = (filters: VenueFilters) =>
    cached(CACHE_NS, `list:${JSON.stringify(filters)}`, CACHE_TTL_SECONDS, async () => {
        const where: WhereOptions[] = []
        if (filters.q) where.push({ [Op.or]: [{ name: { [Op.iLike]: like(filters.q) } }, { description: { [Op.iLike]: like(filters.q) } }] })
        if (filters.location) where.push({ location: { [Op.iLike]: like(filters.location) } })
        if (filters.minCapacity) where.push({ capacity: { [Op.gte]: filters.minCapacity } })
        if (filters.maxPrice !== undefined) where.push({ pricePerHour: { [Op.lte]: filters.maxPrice } })
        if (filters.eventType) where.push({ eventTypes: { [Op.contains]: [filters.eventType] } })
        if (filters.amenities?.length) where.push({ amenities: { [Op.contains]: filters.amenities } })
        if (filters.verifiedOnly) where.push({ isVerified: true })

        // Browsing tolerates replica lag, so this read goes to the replica.
        const { rows, count } = await Venue.findAndCountAll({ where: { [Op.and]: where }, order: SORTS[filters.sort], ...toOffset(filters) })
        return { rows: rows.map(present), total: count }
    })

export const getVenue = (venueId: string) =>
    cached(CACHE_NS, `one:${venueId}`, CACHE_TTL_SECONDS, async () => {
        const venue = await Venue.findByPk(venueId)
        if (!venue) throw notFound("Venue")
        return present(venue)
    })

export const listOwnerVenues = async (ownerId: string, page: PageQuery) => {
    const { rows, count } = await Venue.findAndCountAll({ where: { ownerId }, order: [["createdAt", "DESC"]], ...toOffset(page), useMaster: true })
    return { rows: rows.map(present), total: count }
}

export const createVenue = async (ownerId: string, input: Omit<Parameters<typeof Venue.create>[0], "ownerId" | "venueId">) => {
    const venue = await Venue.create({ ...(input as any), ownerId })
    await invalidateNamespace(CACHE_NS)
    publish("venue.changed", { venueId: venue.venueId })
    return present(venue)
}

const loadOwned = async (venueId: string, actor: AuthUser) => {
    const venue = await Venue.findByPk(venueId, { useMaster: true })
    if (!venue) throw notFound("Venue")
    if (venue.ownerId !== actor.userId && !isStaff(actor.role)) throw forbidden("You do not own this venue")
    return venue
}

export const updateVenue = async (
    venueId: string,
    actor: AuthUser,
    changes: Partial<Pick<Venue, "name" | "description" | "location" | "capacity" | "contact" | "pictures" | "eventTypes" | "amenities" | "cancellationPolicy">> & {
        pricePerHour?: number
        cleaningFee?: number
        refundableDeposit?: number
        overtimePricePerHour?: number
    },
) => {
    const venue = await loadOwned(venueId, actor)
    await venue.update(changes as any)
    await invalidateNamespace(CACHE_NS)
    publish("venue.changed", { venueId })
    return present(venue)
}

export const confirmVenueAvailability = async (venueId: string, actor: AuthUser) => {
    const venue = await loadOwned(venueId, actor)
    await venue.update({ availabilityConfirmedAt: new Date() })
    await invalidateNamespace(CACHE_NS)
    publish("venue.changed", { venueId })
    return present(venue)
}

export const setVenueVerification = async (venueId: string, actor: AuthUser, verified: boolean) => {
    if (!isStaff(actor.role)) throw forbidden("Only venue review staff can verify listings")
    const venue = await Venue.findByPk(venueId, { useMaster: true })
    if (!venue) throw notFound("Venue")
    await venue.update({ isVerified: verified, verifiedAt: verified ? new Date() : null })
    await invalidateNamespace(CACHE_NS)
    publish("venue.changed", { venueId })
    return present(venue)
}

export const deleteVenue = async (venueId: string, actor: AuthUser) => {
    const venue = await loadOwned(venueId, actor)
    await venue.destroy()
    await invalidateNamespace(CACHE_NS)
    publish("venue.changed", { venueId })
}

// ---- used by other modules (via ./index) ----------------------------------------------------

/** Fresh (primary DB, uncached) venue data for money-affecting decisions. */
export const getVenueForBooking = async (venueId: string) => {
    const venue = await Venue.findByPk(venueId, { useMaster: true })
    if (!venue) throw notFound("Venue")
    return {
        venueId: venue.venueId,
        ownerId: venue.ownerId,
        name: venue.name,
        capacity: venue.capacity,
        eventTypes: venue.eventTypes,
        pricePerHour: Number(venue.pricePerHour),
        cleaningFee: Number(venue.cleaningFee),
        refundableDeposit: Number(venue.refundableDeposit),
        overtimePricePerHour: Number(venue.overtimePricePerHour),
        cancellationPolicy: venue.cancellationPolicy,
        currency: venue.currency,
    }
}

export const getVenueSummaries = async (venueIds: string[]) => {
    if (!venueIds.length) return new Map<string, { venueId: string; name: string; location: string }>()
    const venues = await Venue.findAll({ where: { venueId: venueIds }, attributes: ["venueId", "name", "location"], paranoid: false })
    return new Map(venues.map((v) => [v.venueId, { venueId: v.venueId, name: v.name, location: v.location }]))
}

export const isVenueOwner = async (venueId: string, userId: string) => {
    const venue = await Venue.findByPk(venueId, { attributes: ["ownerId"], paranoid: false })
    return venue?.ownerId === userId
}

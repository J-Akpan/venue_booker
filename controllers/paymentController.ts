import express from "express"
import { Op } from "sequelize"
import { AuthRequest } from "../middlewares/userAuth"
import Booking from "../models/Booking"
import Payment from "../models/Payments"
import User from "../models/Users"
import Venue from "../models/Venue"
import { paymentValidation } from "../utilities/validatiton"
import Stripe from "stripe"
import dotenv from "dotenv";
import { number } from "joi"
dotenv.config();

//************************************************************************ */
// create a payment record after a booking
export const createPayment = async (req: AuthRequest, res: express.Response) => {
    try {
        const userId = req.user?.userId
        if (!userId) {
            return res.status(400).json({ msg: "error getting the ID" })
        }

        // Validate the payment details 
        const { error } = paymentValidation.validate(req.body)
        if (error) {
            return res.status(400).json({ msg: "Server error", error: error.details[0]?.message })
        }

    } catch (error) {
        console.error("Error creating payment:", error)
        return res.status(500).json({ msg: "Internal server error" })
    }
}


// ************************************************************************
// process payment using Stripe
export const processPayment = async (req: AuthRequest, res: express.Response) => {
    try {
        const stripe = new Stripe(process.env.stripe_secret_key || "", {
            apiVersion: "2022-11-15" as any,
        })

        //use the userId from the authenticated request
        const userId = req.user?.userId
        if (!userId) { return res.status(400).json({ msg: "error getting the ID" }) }

        // Check if the booking exists and belongs to the user
        const booking = await Booking.findOne({ where: { userId }, include: [User, Venue] })
        if (!booking) { return res.status(404).json({ msg: "Booking not found" }) }
        // console.log(booking)

        // Extract payment details from booking
        const amount = Number(booking.getDataValue('totalPrice'))
        const currency = 'usd' // or derive from booking/venue details
        //get user email from the associated User model
        const userEmail = (booking as any).User.getDataValue('email')
        const venueName = (booking as any).Venue.getDataValue('names')
        const name = (booking as any).User.getDataValue('lastName')
        const description = `Payment for Venue Booking: ${venueName}
         on ${booking.getDataValue('bookingDate')} from ${booking.getDataValue('startTime')} 
         to ${booking.getDataValue('endTime')}`
        console.log(venueName)




        // Create a payment intent
        const session = await stripe.checkout.sessions.create({
            success_url: 'https://example.com/success',
            customer_email: userEmail,
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        unit_amount: amount * 100, // Stripe expects amount in cents
                        product_data: {
                            name: 'Venue',
                            description: description,
                        },
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',

        });
        console.log(session)

        return res.status(200).json({ url: session.url })

    } catch (error) {
        console.error("Error processing payment:", error)
        return res.status(500).json({ msg: "Internal server error" })
    }
}
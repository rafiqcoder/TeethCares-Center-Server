const express = require('express');
const cors = require('cors');
require('dotenv').config();
const port = process.env.PORT || 5000;
const jwt = require('jsonwebtoken');
const { MongoClient,ServerApiVersion,ObjectId } = require('mongodb');
const app = express();

//midleware
app.use(express.json());
app.use(cors());
const stripe = require("stripe")('sk_test_51M7DjLD0ZYFK3b5MWXs06L7zVdu09MnKM6ihLhmioYefamEJCOFECE4pgGFywF5IeHkTuJV0qJZVrBLCqS9Q6wPD00RoCAKOm9');

app.use(express.static("public"));


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.1rvc7ql.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri,{ useNewUrlParser: true,useUnifiedTopology: true,serverApi: ServerApiVersion.v1 });

const verifyJWT = (req,res,next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'Unauthorize Access' })
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token,process.env.ACCESS_SECRET_TOKEN,function (err,decoded) {
        if (err) {
            res.status(403).send({ message: "Forbidden Access" })
        }
        req.decoded = decoded;
        next();
    })
}

async function run() {
    const Appoinments = client.db('TeethCares').collection('appoinments');
    const BookedAppoinments = client.db('TeethCares').collection('bookedAppoinments');
    const UserList = client.db('TeethCares').collection('userList');
    const Payments = client.db('TeethCares').collection('payments');
    try {

        // Query for a movie that has the title 'Back to the Future'
        app.get('/appointments',async (req,res) => {
            const date = req.query.date;
            const query = { AppointedDate: date };
            const cursor = Appoinments.find({});
            const appointOptions = await cursor.toArray();
            const bookedAppoinments = await BookedAppoinments.find(query).toArray();

            appointOptions.forEach(option => {
                const OptionBooked = bookedAppoinments.filter(booked => booked.treatmentName === option.name);
                const bookedSlots = OptionBooked.map(bookedSlots => bookedSlots.slot);
                const remainSlots = option.slots.filter(slot => !bookedSlots.includes(slot));
                option.slots = remainSlots;
            })
            res.send(appointOptions);


        })

        app.get('/checkout/:id',async (req,res) => {
            const { id } = req.params;
            const query = { _id: ObjectId(id) }
            const result = await BookedAppoinments.findOne(query);
            res.send(result)
            console.log(result);
        })

        app.post("/create-payment-intent",async (req,res) => {
            const booking = req.body;
            console.log(booking);
            const price = booking.price;
            console.log(price);
            const amount = price * 100;
            // Create a PaymentIntent with the order amount and currency
            const paymentIntent = await stripe.paymentIntents.create({
                currency: "usd",
                amount: amount,
                // automatic_payment_methods: {
                //     enabled: true,
                // },
                "payment_method_types": [
                    "card"
                ]
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });

        app.post('/appointments',async (req,res) => {
            const data = req.body;
            const email = req.query.email;
            // console.log(email);
            const date = req.query.date;

            const emailQuery = { email: email };
            const dateQuery = { AppointedDate: date };
            const bookedAppoinments = await BookedAppoinments.find(emailQuery).toArray();

            const userTodaysBooked = bookedAppoinments.filter(appoinment => appoinment.AppointedDate === date);
            const alreadyBooked = userTodaysBooked.find(option => option.treatmentName === data.treatmentName);

            if (alreadyBooked) {
                res.send(data.insertedId = false);
            } else {
                const result = await BookedAppoinments.insertOne(data);
                res.send(result);
            }
        });

        app.get('/user/bookedAppointments',verifyJWT,async (req,res) => {
            const email = req.query.email;
            const decoded = req.decoded;
            if (decoded.email !== email) {
                return res.status(403).send({ message: 'forbidden access' })
            }

            const query = { email: email };
            const cursor = BookedAppoinments.find(query).sort({ AppointedDate: -1 });
            const bookedAppoinments = await cursor.toArray();
            res.send(bookedAppoinments);
        });
        app.post('/users',async (req,res) => {
            const user = req.body;
            // console.log(user.email);
            const query = { email: user.email }
            const existUser = await UserList.find(query).toArray();

            if (existUser.length === 0) {
                const result = await UserList.insertOne(user);

                return res.send(result);
            }
        });
        app.get('/jwt',async (req,res) => {
            const email = req.query.email;
            const query = { email: email };
            const user = await UserList.findOne(query);
            if (user) {
                const token = jwt.sign({ email },process.env.ACCESS_SECRET_TOKEN,{ expiresIn: '1d' });
                return res.send({ accessToken: token });
            }
        });
        app.get('/users',verifyJWT,async (req,res) => {
            const email = req.query.email;
            const decoded = req.decoded;
            if (decoded.email === email) {
                const users = await UserList.find({}).toArray()

                return (res.send(users))
            }
            res.status(403).send({ message: 'Forbidden' })

        })
        app.get('/users/admin/:email',verifyJWT,async (req,res) => {
            const { email } = req.params;

            const decoded = req.decoded;
            if (decoded.email === email) {
                const user = await UserList.findOne({ email: email })

                if (user.role === 'admin') {
                    return res.send({ message: 'success' })
                }

                return res.status(403).send({ message: 'forbidden' })

            }
            res.status(403).send({ message: 'Forbidden' })

        })
        app.delete('/users/:id',async (req,res) => {
            const { id } = req.params;
            const query = { _id: ObjectId(id) }
            const result = await UserList.deleteOne(query);
            res.send(result)

        })
        app.patch('/users/admin/:id',verifyJWT,async (req,res) => {
            const { id } = req.params;
            const email = req.query.email;
            const decoded = req.decoded;
            if (decoded?.email !== email) {

                return res.status(403).send('Forbidden Access')
            }
            const existUserQuery = { email: email }
            const filter = { _id: ObjectId(id) }
            const option = { upsert: true }
            const currentUser = await UserList.findOne(existUserQuery);

            if (currentUser.role !== 'admin') {
                return res.status(403).send('forbidden access')
            }
            const result = await UserList.updateOne(filter,{ $set: { role: 'admin' } });

            res.send(result)

        })
        app.patch('/users/subscriber/:id',verifyJWT,async (req,res) => {
            const { id } = req.params;
            const email = req.query.email;
            const decoded = req.decoded;
            if (decoded.email !== email) {

                return res.status(403).send('Forbidden Access')
            }
            const filter = { _id: ObjectId(id) }
            const option = { upsert: true }
            const existUserQuery = { email: email }
            const currentUser = await UserList.findOne(existUserQuery);

            if (currentUser.role !== 'admin') {
                return res.status(403).send('forbidden access')
            }
            const result = await UserList.updateOne(filter,{ $set: { role: 'Subscriber' } });

            res.send(result)

        })
        // app.get('/addPrice',async (req,res) => {

        //     const filter = {};
        //     const updateDoc = { $set: { price: 100 } }
        //     const option = { upsert: true }
        //     const bookings = await Appoinments.updateMany(filter,updateDoc,option);
        //     res.send(bookings)
        // });

    } finally {

    }

}
run().catch(console.dir);





app.listen(port,() => {
    console.log(`Server is running on port: ${port}`);
})
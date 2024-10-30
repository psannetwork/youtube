#!/bin/bash

npm install -g pm2
clear
echo " ____                             _                      _    "
echo "|  _ \ ___  __ _ _ __  _ __   ___| |___      _____  _ __| | __"
echo "| |_) / __|/ _\` | '_ \| '_ \ / _ \ __\ \ /\ / / _ \| '__| |/ /"
echo "|  __/\__ \ (_| | | | | | | |  __/ |_ \ V  V / (_) | |  |   < "
echo "|_|   |___/\__,_|_| |_|_| |_|\___|\__| \_/\_/ \___/|_|  |_|\_\\"

echo "Select an option:"
echo "1) Start the application"
echo "2) Stop and delete the application"
echo "3) Check application status"
echo "4) View application logs"

read -p "Enter your choice: " CHOICE

if [ "$CHOICE" == "1" ]; then
    sudo apt install ffmpeg
    git clone https://github.com/hirotomoki12345/youtube.git
    cd youtube/v3
    npm install
    sudo pm2 start npm --name "youtube-app" -- start 
    echo "Application started on port 3020."
    cd -

    # Save the PM2 process list and configure PM2 to start on boot
    sudo pm2 save
    sudo pm2 startup
    echo "PM2 startup script has been configured. Your application will start automatically on boot."
    sudo pm2 save

elif [ "$CHOICE" == "2" ]; then
    sudo pm2 stop "youtube-app"
    sudo pm2 delete "youtube-app"
    echo "Application stopped and deleted."

elif [ "$CHOICE" == "3" ]; then
    pm2 status "youtube-app"

elif [ "$CHOICE" == "4" ]; then
    pm2 logs "youtube-app"

else
    echo "Invalid choice. Please run the script again and select a valid option."
fi
